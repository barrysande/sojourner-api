import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import GroupSubscription from '#models/group_subscription'
import GroupSubscriptionMember from '#models/group_subscription_member'
import User from '#models/user'
import { customAlphabet } from 'nanoid'
import TierService from './tier_service.js'
import GracePeriodService from './grace_period_service.js'
import DodoPaymentService from './dodo_payment_service.js'
import { createGroupSubPayloadValidator } from '#validators/subscription'
import type {
  CreateGroupSubscriptionParams,
  ChangeGroupSubscriptionPlanParams,
  SubscriptionCreateResponse,
} from '../../types/payments.js'
import ConflictException from '#exceptions/conflict_exception'
import {
  UserAlreadyInGroupException,
  OwnerRemovalException,
  ActionDeniedException,
} from '#exceptions/payment_errors_exception'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import SubscriptionConflictException from '#exceptions/subscription_conflict_exception'
import type { Infer } from '@vinejs/vine/types'
import { Exception } from '@adonisjs/core/exceptions'
import { Subscription } from 'dodopayments/resources/subscriptions.mjs'
import NotificationService from './notification_service.js'
import { GroupSubscriptionFullException } from '#exceptions/subscription_conflict_exception'

type CreateGroupPayload = Infer<typeof createGroupSubPayloadValidator>
type PlanType = 'monthly' | 'quarterly' | 'annual'

type GroupSubscriptionRole = 'owner' | 'member'

interface GroupSubscriptionContext {
  subscription: GroupSubscription
  role: GroupSubscriptionRole
}

@inject()
export class GroupSubscriptionService {
  constructor(
    protected tierService: TierService,
    protected gracePeriodService: GracePeriodService,
    protected dodoPaymentService: DodoPaymentService,
    protected notificationService: NotificationService
  ) {}

  /**
   * Generate 8-character alphanumeric invite code
   * Format: Uppercase letters and numbers only (e.g., XK94PL72)
   */
  async generateInviteCode(): Promise<string> {
    // if there are any code collisions just bump chars to 21 and check the table column constraints for changes needed.
    const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 12)
    const code = nanoid()
    return code.match(/.{1,4}/g)?.join('-') || code
  }

  /**
   * Calculate invite code expiry (30 days validity)
   */
  calculateInviteCodeExpiry(): DateTime {
    return DateTime.now().plus({ days: 30 })
  }

  /**
   * Create group subscription via Dodo Payments
   * Owner automatically becomes first member
   *
   * @param ownerId - User creating the group subscription
   * @param planType - monthly/quarterly/annual
   * @param totalSeats - Number of seats (includes owner)
   * @param productId - Dodo product ID for group plan
   * @param billingAddress - Owner's billing address
   * @param customer - Owner's customer information
   */
  async createGroupSubscription(
    ownerUserId: number,
    payload: CreateGroupPayload
  ): Promise<SubscriptionCreateResponse> {
    const conflictCheck = await this.tierService.canCreateGroupSubscription(ownerUserId)

    if (!conflictCheck.canCreate) {
      throw new SubscriptionConflictException(conflictCheck.reason!)
    }

    const dodoParams: CreateGroupSubscriptionParams = {
      productId: payload.product_id,
      quantity: payload.quantity,
      customer: {
        email: payload.customer.email,
        name: payload.customer.name,
        phoneNumber: payload.customer.phone_number,
      },
      billing: {
        street: payload.billing.street,
        city: payload.billing.city,
        state: payload.billing.state,
        zipcode: payload.billing.zipcode,
        country: payload.billing.country,
      },
      addons: payload.addons || [],
      returnUrl: payload.return_url,
      paymentLink: payload.payment_link,
      trialPeriodDays: payload.trial_period_days,

      // Edge Case: VERY VITAL for for self-recovery incase a user pays but for some reason the database fails to create a subscription record with pending status. The scheduled worker will use the userId and subscription_type to recreate it thereby correcting the failure. This means the job will be successfully processed.
      metadata: {
        ...payload.metadata,
        ownerUserId: ownerUserId.toString(),
        subscription_type: 'group',
      },
    }

    logger.info('Creating group subscription with Dodo', {
      ownerUserId,
      totalSeats: dodoParams.addons[0].quantity,
      productId: dodoParams.productId,
    })

    const dodoResponse = await this.dodoPaymentService.createGroupSubscription(dodoParams)

    try {
      return await db.transaction(async (trx) => {
        const inviteCode = await this.generateInviteCode()
        const inviteCodeExpiresAt = this.calculateInviteCodeExpiry()

        const subscription = await GroupSubscription.create(
          {
            ownerUserId,
            dodoSessionId: dodoResponse.sessionId,
            dodoSubscriptionId: null,
            totalSeats: dodoParams.addons[0].quantity,
            inviteCode,
            inviteCodeExpiresAt,
            status: 'pending',
            planType: payload.plan_type,
          },
          { client: trx }
        )

        await GroupSubscriptionMember.create(
          {
            groupSubscriptionId: subscription.id,
            userId: ownerUserId,
            joinedAt: DateTime.now(),
            status: 'active',
          },
          { client: trx }
        )

        return {
          checkoutUrl: dodoResponse.checkoutUrl,
          sessionId: dodoResponse.sessionId,
        }
      })
    } catch (dbError) {
      logger.error('CRITICAL: Failed to save group subscription record after payment success', {
        sessionId: dodoResponse.sessionId,
        ownerUserId,
        error: dbError.message,
        stack: dbError.stack,
      })

      throw new Exception(
        'Payment was processed but failed to update account. Please contact support.',
        {
          status: 500,
          code: 'E_SUBSCRIPTION_SAVE_FAILED',
        }
      )
    }
  }

  /**
   * User joins group subscription via invite code
   * Validates if user can join, invite code, seat availability, and tier conflicts
   *
   * @param userId - User joining the group
   * @param inviteCode - 8-character invite code
   */
  async joinGroupSubscription(userId: number, inviteCode: string): Promise<GroupSubscription> {
    return await db.transaction(async (trx) => {
      const canJoin = await this.tierService.canJoinGroupSubscription(userId, trx)
      if (!canJoin.canJoin) {
        throw new ConflictException(canJoin.reason!)
      }

      const groupSubscription = await GroupSubscription.query({ client: trx })
        .where('invite_code', inviteCode.toUpperCase())
        .where('status', 'active')
        .where('invite_code_expires_at', '>', DateTime.now().toSQL())
        .forUpdate()
        .firstOrFail()

      const memberCount = await GroupSubscriptionMember.query({ client: trx })
        .where('group_subscription_id', groupSubscription.id)
        .where('status', 'active')
        .count('* as total')

      if (Number(memberCount[0].$extras.total) >= groupSubscription.totalSeats) {
        throw new GroupSubscriptionFullException('Seats fully occupied.')
      }

      try {
        await GroupSubscriptionMember.create(
          {
            groupSubscriptionId: groupSubscription.id,
            userId,
            joinedAt: DateTime.now(),
            status: 'active',
          },
          { client: trx }
        )
      } catch (error) {
        if (error.code === '23505') {
          throw new UserAlreadyInGroupException('You are already an active member of this group.')
        }
        throw error
      }

      await this.tierService.updateUserTier(userId, 'Joined group subscription', 'join', trx, {
        groupSubscriptionId: groupSubscription.id,
      })

      await this.notificationService.createSubscriptionJoinNotification(
        groupSubscription.id,
        userId,
        trx
      )

      return groupSubscription
    })
  }

  /**
   * Removes member from group subscription
   * Check subscription existance
   * Verify the remover is owner
   * prevent owner from removing themselves
   * Starts 7-day grace period
   *
   * @param groupSubId - Group subscription ID
   * @param userId - User to remove
   */
  async removeMemberFromSubscriptionGroup(
    removedByUserId: number,
    userIdToRemove: number
  ): Promise<void> {
    await db.transaction(async (trx) => {
      const groupSubscription = await GroupSubscription.query({ client: trx })
        .where('ownerUserId', removedByUserId)
        .where('status', 'active')
        .forUpdate()
        .firstOrFail()

      if (groupSubscription.ownerUserId === userIdToRemove) {
        throw new OwnerRemovalException()
      }

      const membership = await GroupSubscriptionMember.query({ client: trx })
        .where('group_subscription_id', groupSubscription.id)
        .where('user_id', userIdToRemove)
        .where('status', 'active')
        .forUpdate()
        .firstOrFail()

      await membership.useTransaction(trx).merge({ status: 'removed' }).save()

      await this.gracePeriodService.startGracePeriod(
        userIdToRemove,
        'group_removal',
        'group_paid',
        trx
      )

      await this.tierService.updateUserTier(
        userIdToRemove,
        'Removed from group subscription',
        'manual',
        trx,
        {
          group_subscription_id: groupSubscription.id,
          removed_by_user_id: removedByUserId,
          grace_period_days: 7,
        }
      )

      await this.notificationService.createSubscriptionRemovedNotification(
        groupSubscription.id,
        userIdToRemove,
        trx
      )
    })
  }

  /**
   * Change group subscription from monthly to either quarterly or annual.
   * Prorated charge applied immediately by Dodo Payments
   */
  async changeGroupSubscriptionPlan(
    groupSubscriptionId: number,
    requestingUserId: number,
    newPlanType: PlanType,
    params: ChangeGroupSubscriptionPlanParams
  ): Promise<string> {
    const groupSubscription = await GroupSubscription.query()
      .where('owner_user_id', requestingUserId)
      .where('id', groupSubscriptionId)
      .where('status', 'active')
      .firstOrFail()

    if (groupSubscription.planType === newPlanType) {
      throw new Error(`Already subscribed to ${newPlanType} plan`)
    }
    const oldPlanType = groupSubscription.planType

    if (!params.addons || params.addons.length === 0) {
      throw new Error('Addons are required for group subscriptions')
    }

    if (params.addons[0].quantity > 20) {
      throw new ActionDeniedException('Maximum seats is 20.')
    }

    const newSeats = params.addons[0].quantity

    const filledSeats = await this.getAvailableSeats(groupSubscription.id)

    if (newSeats < filledSeats.usedSeats) {
      throw new ActionDeniedException(
        `Cannot reduce seats below current members (${filledSeats.usedSeats})`
      )
    }

    const result = await this.dodoPaymentService.changeGroupSubscriptionPlan(
      groupSubscription.dodoSubscriptionId!,
      params
    )

    logger.info('Group subscription seats expanded', {
      oldPlanType,
      newPlanType,
      groupSubscriptionId,
      oldSeats: groupSubscription.totalSeats,
      newSeats: params.addons[0].quantity,
      requestedBy: requestingUserId,
    })

    return result
  }

  /**
   * Expand seats for group subscription (mid-cycle increase)
   * Prorated charge applied immediately by Dodo Payments
   */
  async expandSeats(
    groupSubscriptionId: number,
    requestingUserId: number,
    params: ChangeGroupSubscriptionPlanParams
  ): Promise<string> {
    const groupSubscription = await GroupSubscription.findOrFail(groupSubscriptionId)

    if (Number(groupSubscription.ownerUserId) !== requestingUserId) {
      throw new ActionDeniedException('You must be a group owner to add seats.')
    }

    if (params.addons[0].quantity <= groupSubscription.totalSeats) {
      throw new ActionDeniedException('New seat count must be greater than current seats')
    }

    if (params.addons[0].quantity > 20) {
      throw new ActionDeniedException('Maximum seats is 20.')
    }

    const result = await this.dodoPaymentService.changeGroupSubscriptionSeats(
      groupSubscription.dodoSubscriptionId!,
      params
    )

    // TODO in worker: Update totalSeats to new seat count on subscription.plan_changed

    logger.info('Group subscription seats expanded', {
      groupSubscriptionId,
      oldSeats: groupSubscription.totalSeats,
      newSeats: params.addons[0].quantity,
      requestedBy: requestingUserId,
    })

    return result
  }

  /**
   * Reduce seats for group subscription (mid-cycle decrease)
   * Blocked if new quantity < current member count
   */
  async reduceSeats(
    groupSubscriptionId: number,
    requestingUserId: number,
    params: ChangeGroupSubscriptionPlanParams
  ): Promise<string> {
    const groupSubscription = await GroupSubscription.findOrFail(groupSubscriptionId)

    if (Number(groupSubscription.ownerUserId) !== requestingUserId) {
      throw new ActionDeniedException('You must be a group owner to add seats.')
    }

    if (params.addons[0].quantity >= groupSubscription.totalSeats) {
      throw new ActionDeniedException(
        `New seat count (${params.addons[0].quantity}) must be less than current seats (${groupSubscription.totalSeats})`
      )
    }

    if (params.addons[0].quantity < 1) {
      throw new ActionDeniedException('Minimum 1 seat required (for owner)')
    }

    const currentMembers = await GroupSubscriptionMember.query()
      .where('group_subscription_id', groupSubscription.id)
      .where('status', 'active')
      .count('* as total')

    const activeMemberCount = Number(currentMembers[0].$extras.total)

    if (params.addons[0].quantity < activeMemberCount) {
      throw new Error(
        `Cannot reduce seats to ${params.addons[0].quantity}. You currently have ${activeMemberCount} active members. Remove members first.`
      )
    }

    const dodoResponse = await this.dodoPaymentService.changeGroupSubscriptionSeats(
      groupSubscription.dodoSubscriptionId!,
      params
    )

    //TODO in worker: Update totalSeats to new seat count on subscription.plan_changed

    logger.info('Group subscription seats expanded', {
      groupSubscriptionId,
      oldSeats: groupSubscription.totalSeats,
      newSeats: params.addons[0].quantity,
      requestedBy: requestingUserId,
    })

    return dodoResponse
  }

  /**
   * Cancel group subscription (cancel_at_next_billing_date)
   * All members keep access until expiry
   * Grace periods start when subscription expires
   */
  async cancelGroupSubscription(
    groupSubscriptionId: number,
    ownerUserId: number
  ): Promise<Partial<Subscription>> {
    const groupSubscription = await GroupSubscription.query()
      .where('id', groupSubscriptionId)
      .where('status', 'active')
      .firstOrFail()

    if (groupSubscription.ownerUserId !== ownerUserId) {
      throw new ActionDeniedException('Only the owner can cancel the subscription')
    }

    const dodoResponse = await this.dodoPaymentService.cancelSubscription(
      groupSubscription.dodoSubscriptionId!,
      true
    )

    await groupSubscription
      .merge({
        status: 'cancelled',
        cancelAtNextBillingDate: true,
      })
      .save()

    logger.info('Group subscription cancelled', {
      groupSubscriptionId,
      ownerUserId,
      expiresAt: groupSubscription.expiresAt?.toISO(),
    })
    return dodoResponse
  }

  /**
   * Regenerate invite code for group subscription
   * Old code becomes invalid, new code expires in 30 days
   * Try generating random code up to 10 times if it is unique, save and return it, if it is not throw an error.
   */
  async regenerateInviteCodeForOwner(
    requestingUserId: number
  ): Promise<{ inviteCode: string; expiresAt: DateTime }> {
    return await db.transaction(async (trx) => {
      const groupSubscription = await GroupSubscription.query({ client: trx })
        .where('ownerUserId', requestingUserId)
        .where('status', 'active')
        .forUpdate()
        .firstOrFail()

      const newInviteCode = await this.generateInviteCode()
      const expiresAt = DateTime.now().plus({ days: 30 })

      await groupSubscription
        .useTransaction(trx)
        .merge({
          inviteCode: newInviteCode,
          inviteCodeExpiresAt: expiresAt,
        })
        .save()

      logger.info('Invite code regenerated', {
        groupSubscriptionId: groupSubscription.id,
        requestedBy: requestingUserId,
      })

      return {
        inviteCode: newInviteCode,
        expiresAt,
      }
    })
  }

  /**
   * Get available seats in group subscription
   * @returns Object with total, used, and available seats
   */
  async getAvailableSeats(groupSubcriptionId: number): Promise<{
    totalSeats: number
    usedSeats: number
    availableSeats: number
  }> {
    const groupSubcription = await GroupSubscription.findOrFail(groupSubcriptionId)

    const currentMembers = await GroupSubscriptionMember.query()
      .where('group_subscription_id', groupSubcriptionId)
      .where('status', 'active')
      .count('* as total')

    const usedSeats = Number(currentMembers[0].$extras.total)
    const availableSeats = groupSubcription.totalSeats - usedSeats

    return {
      totalSeats: groupSubcription.totalSeats,
      usedSeats,
      availableSeats,
    }
  }

  /**
   * Get active group subscription for user (as member)
   * Returns null if user is not a member of any active group
   * @params userId: number
   */
  async getActiveGroupMembership(userId: number): Promise<GroupSubscription | null> {
    const membership = await GroupSubscriptionMember.query()
      .where('user_id', userId)
      .where('status', 'active')
      .whereHas('groupSubscription', (query) => {
        query.where('status', 'active').where('expires_at', '>', DateTime.now().toSQL())
      })
      .preload('groupSubscription')
      .orderBy('joined_at', 'desc')
      .first()

    return membership?.groupSubscription || null
  }

  /**
   * Get group subscription for group subscription members
   * Returns null if user doesn't own any active group subscription
   * @params userId: number
   */
  async resolveGroupSubscriptionContext(userId: number): Promise<GroupSubscriptionContext> {
    const subscription = await GroupSubscription.query()
      .where('status', 'active')
      .where('expires_at', '>', DateTime.now().toSQL())
      .where((query) => {
        query.where('owner_user_id', userId).orWhereHas('members', (memberQuery) => {
          memberQuery.where('user_id', userId).where('status', 'active')
        })
      })
      .preload('owner')
      .preload('members', (q) => q.where('status', 'active'))
      .firstOrFail()

    const role: GroupSubscriptionRole =
      Number(subscription.ownerUserId) === Number(userId) ? 'owner' : 'member'

    return { subscription, role }
  }

  /**
   * Get group subscription owned by user
   * Returns null if user doesn't own any active group subscription
   * @params userId: number
   */
  async getOwnedGroupSubscription(userId: number): Promise<GroupSubscription> {
    return await GroupSubscription.query()
      .where('owner_user_id', userId)
      .where('status', 'active')
      .where('expires_at', '>', DateTime.now().toSQL())
      .firstOrFail()
  }

  async listGroupSubscriptionMembers(ownerUserId: number) {
    const groupSubscription = await GroupSubscription.query()
      .where('owner_user_id', ownerUserId)
      .where('status', 'active')
      .preload('members', (query) => {
        query.where('status', 'active').preload('user', (userQuery) => {
          userQuery.select('id', 'full_name')
        })
      })
      .first()

    if (!groupSubscription) {
      return []
    }

    return groupSubscription.members
  }

  async handleSubscriptionActive(
    ownerUserId: number,
    dodoSubscriptionId: string,
    dodoCustomerId: string,
    expiresAt: string,
    trx: TransactionClientContract
  ): Promise<User> {
    const groupSubscription = await GroupSubscription.query({ client: trx })
      .where('owner_user_id', ownerUserId)
      .whereNull('dodoSubscriptionId')
      .preload('owner')
      .forUpdate()
      .firstOrFail()

    const owner = groupSubscription.owner

    await groupSubscription
      .useTransaction(trx)
      .merge({
        dodoSubscriptionId,
        dodoCustomerId,
        status: 'active',
        expiresAt: DateTime.fromISO(expiresAt),
      })
      .save()

    const members = await GroupSubscriptionMember.query({ client: trx })
      .where('group_subscription_id', groupSubscription.id)
      .where('status', 'active')

    await Promise.all(
      members.map(async (member) => {
        await this.gracePeriodService.clearGracePeriod(member.userId, trx)

        await this.tierService.updateUserTier(
          member.userId,
          'Group subscription activated',
          'webhook',
          trx,
          { group_subscription_id: groupSubscription.id }
        )
      })
    )

    return owner
  }

  async handleSubscriptionRenewed(
    ownerUserId: number,
    dodoSubscriptionId: string,
    newExpiresAt: string,
    trx: TransactionClientContract
  ): Promise<User> {
    const groupSubscription = await GroupSubscription.query({ client: trx })
      .where('owner_user_id', ownerUserId)
      .preload('owner')
      .forUpdate()
      .firstOrFail()

    const owner = groupSubscription.owner

    // Populate dodoSubscriptionId if missing (handles out-of-order webhooks)
    if (!groupSubscription.dodoSubscriptionId) {
      groupSubscription.dodoSubscriptionId = dodoSubscriptionId
    }

    await groupSubscription
      .useTransaction(trx)
      .merge({ expiresAt: DateTime.fromISO(newExpiresAt), status: 'active' })
      .save()

    const members = await GroupSubscriptionMember.query({ client: trx })
      .where('group_subscription_id', groupSubscription.id)
      .where('status', 'active')

    await Promise.all(
      members.map((member) =>
        this.tierService.updateUserTier(
          member.userId,
          'Group subscription renewed.',
          'webhook',
          trx,
          { group_subscription_id: groupSubscription.id }
        )
      )
    )

    return owner
  }

  async handleSubscriptionCancelled(
    ownerUserId: number,
    dodoSubscriptionId: string,
    trx: TransactionClientContract
  ): Promise<User> {
    const groupSubscription = await GroupSubscription.query({ client: trx })
      .where('owner_user_id', ownerUserId)
      .preload('owner')
      .forUpdate()
      .firstOrFail()

    const owner = groupSubscription.owner

    // Populate dodoSubscriptionId if missing
    if (!groupSubscription.dodoSubscriptionId) {
      groupSubscription.dodoSubscriptionId = dodoSubscriptionId
    }

    await groupSubscription.useTransaction(trx).merge({ status: 'cancelled' }).save()

    const members = await GroupSubscriptionMember.query({ client: trx })
      .where('group_subscription_id', groupSubscription.id)
      .where('status', 'active')

    await Promise.all(
      members.map((member) =>
        this.tierService.updateUserTier(
          member.userId,
          'Group subscription cancelled',
          'webhook',
          trx,
          {
            group_subscription_id: groupSubscription.id,
            expires_at: groupSubscription.expiresAt?.toISO(),
          }
        )
      )
    )

    return owner
  }

  async handleSubscriptionFailed(
    ownerUserId: number,
    dodoSubscriptionId: string,
    trx: TransactionClientContract
  ): Promise<User> {
    const groupSubscription = await GroupSubscription.query({ client: trx })
      .where('owner_user_id', ownerUserId)
      .preload('owner')
      .forUpdate()
      .firstOrFail()

    const owner = groupSubscription.owner

    // Populate dodoSubscriptionId if missing
    if (!groupSubscription.dodoSubscriptionId) {
      groupSubscription.dodoSubscriptionId = dodoSubscriptionId
    }

    await groupSubscription.useTransaction(trx).merge({ status: 'on_hold' }).save()

    const members = await GroupSubscriptionMember.query({ client: trx })
      .where('group_subscription_id', groupSubscription.id)
      .where('status', 'active')

    await Promise.all(
      members.map(async (member) => {
        await this.gracePeriodService.startGracePeriod(
          member.userId,
          'payment_failure',
          'group_paid',
          trx
        )

        await this.tierService.updateUserTier(
          member.userId,
          'group_subscription_payment_failed',
          'webhook',
          trx,
          {
            group_subscription_id: groupSubscription.id,
            grace_period_days: 3,
          }
        )
      })
    )

    return owner
  }

  async handleSubscriptionPlanChanged(
    ownerUserId: number,
    dodoSubscriptionId: string,
    newQuantity: number,
    newPlanType: PlanType,
    trx: TransactionClientContract
  ): Promise<User> {
    const groupSubscription = await GroupSubscription.query({ client: trx })
      .where('owner_user_id', ownerUserId)
      .preload('owner')
      .forUpdate()
      .firstOrFail()

    const owner = groupSubscription.owner

    // Populate dodoSubscriptionId if missing
    if (!groupSubscription.dodoSubscriptionId) {
      groupSubscription.dodoSubscriptionId = dodoSubscriptionId
    }

    await groupSubscription
      .useTransaction(trx)
      .merge({ status: 'active', totalSeats: newQuantity, planType: newPlanType })
      .save()

    await this.tierService.updateUserTier(
      groupSubscription.ownerUserId,
      'Changed subscription plan.',
      'webhook',
      trx,
      { group_subscription_id: groupSubscription.id }
    )

    return owner
  }

  async handleSubscriptionExpired(
    ownerUserId: number,
    dodoSubscriptionId: string,
    trx: TransactionClientContract
  ): Promise<User> {
    const groupSubscription = await GroupSubscription.query({ client: trx })
      .where('owner_user_id', ownerUserId)
      .preload('owner')
      .forUpdate()
      .firstOrFail()

    const owner = groupSubscription.owner

    // Populate dodoSubscriptionId if missing
    if (!groupSubscription.dodoSubscriptionId) {
      groupSubscription.dodoSubscriptionId = dodoSubscriptionId
    }

    await groupSubscription.useTransaction(trx).merge({ status: 'expired' }).save()

    const members = await GroupSubscriptionMember.query({ client: trx })
      .where('group_subscription_id', groupSubscription.id)
      .where('status', 'active')

    await Promise.all(
      members.map((member) =>
        this.tierService.updateUserTier(
          member.userId,
          'Group subscription expired',
          'webhook',
          trx,
          {
            group_subscription_id: groupSubscription.id,
          }
        )
      )
    )

    return owner
  }

  async getCustomerPortalLink(userId: number): Promise<{ link: string }> {
    return await this.dodoPaymentService.getGroupCustomerPortalLink(userId)
  }
}
