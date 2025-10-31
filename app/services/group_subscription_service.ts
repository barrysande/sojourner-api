import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import GroupSubscription from '#models/group_subscription'
import GroupSubscriptionMember from '#models/group_subscription_member'
import { customAlphabet } from 'nanoid'
import TierService from './tier_service.js'
import { GracePeriodService } from './grace_period_service.js'
import { DodoPaymentService } from './dodo_payment_service.js'
import type {
  CreateGroupSubscriptionParams,
  ChangeGroupSubscriptionPlanParams,
} from '../../types/webhook.js'
import type { SubscriptionCreateResponse } from 'dodopayments/resources/subscriptions.mjs'

import {
  UserAlreadyInGroupException,
  OwnerRemovalException,
  ActionDeniedException,
} from '#exceptions/payment_errors_exception'

type PlanType = 'monthly' | 'quarterly' | 'annual'

@inject()
export class GroupSubscriptionService {
  constructor(
    protected tierService: TierService,
    protected gracePeriodService: GracePeriodService,
    protected dodoPaymentService: DodoPaymentService
  ) {}

  /**
   * Generate 8-character alphanumeric invite code
   * Format: Uppercase letters and numbers only (e.g., XK94PL72)
   */
  private async generateInviteCode(): Promise<string> {
    // if there start to be code collisions just bump chars to 21
    const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 12)
    const code = nanoid()
    return code.match(/.{1,4}/g)?.join('-') || code
  }

  /**
   * Calculate expiry date based on plan type
   */

  /**
   * Calculate invite code expiry (30 days from now)
   */
  private calculateInviteCodeExpiry(): DateTime {
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
    planType: PlanType,
    params: CreateGroupSubscriptionParams
  ): Promise<SubscriptionCreateResponse> {
    // 1. call dodo api create sub endpoint
    logger.info('Creating group subscription with Dodo', {
      ownerUserId,
      totalSeats: params.addons[0].quantity,
      productId: params.productId,
    })
    const dodoResponse = await this.dodoPaymentService.createGroupSubscription(params)

    return await db.transaction(async (trx) => {
      // 2. Generate invite code
      const inviteCode = await this.generateInviteCode()
      const inviteCodeExpiresAt = this.calculateInviteCodeExpiry()

      // 3. create subscription group
      const subscription = await GroupSubscription.create(
        {
          ownerUserId,
          dodoSubscriptionId: dodoResponse.subscription_id,
          totalSeats: params.addons[0].quantity,
          inviteCode,
          inviteCodeExpiresAt,
          status: 'pending',
          planType,
        },
        { client: trx }
      )

      // 4. make owner a member of created group
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
        addons: dodoResponse.addons,
        customer: dodoResponse.customer,
        metadata: dodoResponse.metadata,
        payment_id: dodoResponse.payment_id,
        recurring_pre_tax_amount: dodoResponse.recurring_pre_tax_amount,
        subscription_id: dodoResponse.subscription_id,
      }
    })
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
        throw new Error(canJoin.reason)
      }

      const groupSubscription = await GroupSubscription.query()
        .where('invite_code', inviteCode.toUpperCase())
        .where('status', 'active')
        .where('invite_code_expires_at', '>', DateTime.now().toSQL())
        .forUpdate()
        .firstOrFail()

      const memberCount = await GroupSubscriptionMember.query({ client: trx })
        .where('group_subscription_id', groupSubscription.id)
        .where('status', 'active')
        .forUpdate()
        .count('* as total')

      if (Number(memberCount[0].$extras.total) >= groupSubscription.totalSeats) {
        throw new Error('This group is full')
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
          throw new UserAlreadyInGroupException()
        }
        throw error
      }

      await this.tierService.updateUserTier(userId, 'Joined group subscription', 'join', trx, {
        groupSubscriptionId: groupSubscription.id,
      })

      logger.info('User joined group subscription', {
        userId,
        groupSubscriptionId: groupSubscription.id,
      })

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
    groupSubscriptionId: number,
    userIdToRemove: number,
    removedByUserId: number
  ): Promise<void> {
    await db.transaction(async (trx) => {
      const groupSubscription = await GroupSubscription.query({ client: trx })
        .where('id', groupSubscriptionId)
        .where('status', 'active')
        .forUpdate()
        .firstOrFail()

      if (groupSubscription.ownerUserId !== removedByUserId) {
        throw new ActionDeniedException('Only the owner can remove members from the group.')
      }

      if (groupSubscription.ownerUserId === userIdToRemove) {
        throw new OwnerRemovalException()
      }

      const membership = await GroupSubscriptionMember.query({ client: trx })
        .where('group_subscription_id', groupSubscriptionId)
        .where('user_id', userIdToRemove)
        .where('status', 'active')
        .forUpdate()
        .firstOrFail()
      await membership.useTransaction(trx).merge({ status: 'removed' }).save()

      // Start 7-day grace period
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
          group_subscription_id: groupSubscriptionId,
          removed_by_user_id: removedByUserId,
          grace_period_days: 7,
        }
      )

      logger.info('Member removed from group subscription', {
        groupSubscriptionId,
        removedUserId: userIdToRemove,
        removedBy: removedByUserId,
      })
    })
  }

  /**
   * Expand seats for group subscription (mid-cycle increase)
   * Prorated charge applied immediately by Dodo Payments
   *
   * @param groupSubId - Group subscription ID
   * @param newQuantity - New total seat count
   */
  async expandSeats(
    groupSubscriptionId: number,
    requestingUserId: number,
    params: ChangeGroupSubscriptionPlanParams
  ): Promise<string> {
    try {
      const groupSubscription = await GroupSubscription.findOrFail(groupSubscriptionId)

      if (groupSubscription.ownerUserId !== requestingUserId) {
        throw new ActionDeniedException('You must be a group owner to add seats.')
      }

      if (params.addons[0].quantity <= groupSubscription.totalSeats) {
        throw new ActionDeniedException('New seat count must be greater than current seats')
      }

      if (params.addons[0].quantity > 20) {
        throw new ActionDeniedException('Maximum seats is 20.')
      }

      await this.dodoPaymentService.changeGroupSubscriptionPlan(
        groupSubscription.dodoSubscriptionId,
        params
      )

      // TODO in worker: Update totalSeats to new seat count on subscription.plan_changed

      logger.info('Group subscription seats expanded', {
        groupSubscriptionId,
        oldSeats: groupSubscription.totalSeats,
        newSeats: params.addons[0].quantity,
        requestedBy: requestingUserId,
      })

      return 'Subscription plan changed'
    } catch (error) {
      logger.error('Failed to expand seats', {
        error: error.message,
        groupSubscriptionId,
        newTotalSeats: params.addons[0].quantity,
      })
      throw error
    }
  }

  /**
   * Reduce seats for group subscription (mid-cycle decrease)
   * Blocked if new quantity < current member count
   *
   * @param groupSubId - Group subscription ID
   * @param newQuantity - New total seat count
   */
  async reduceSeats(
    dodoSubscriptionId: string,
    groupSubscriptionId: number,
    requestingUserId: number,
    params: ChangeGroupSubscriptionPlanParams
  ): Promise<string> {
    await db.transaction(async (trx) => {
      const groupSubscription = await GroupSubscription.query({ client: trx })
        .where('id', groupSubscriptionId)
        .forUpdate()
        .firstOrFail()

      if (groupSubscription.ownerUserId !== requestingUserId) {
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

      const currentMembers = await GroupSubscriptionMember.query({ client: trx })
        .where('group_subscription_id', groupSubscription.id)
        .where('status', 'active')
        .forUpdate()
        .count('* as total')

      const activeMemberCount = Number(currentMembers[0].$extras.total)

      if (params.addons[0].quantity < activeMemberCount) {
        throw new Error(
          `Cannot reduce seats to ${params.addons[0].quantity}. You currently have ${activeMemberCount} active members. Remove members first.`
        )
      }
    })

    await this.dodoPaymentService.changeGroupSubscriptionPlan(dodoSubscriptionId, params)

    // 6. TODO in worker: Update totalSeats to new seat count on subscription.plan_changed

    logger.info('Group subscription seats reduced', {
      groupSubscriptionId,
      dodoSubscriptionId,
    })

    return 'Subscription plan changed'
  }

  /**
   * Cancel group subscription (cancel_at_next_billing_date)
   * All members keep access until expiry
   * Grace periods start when subscription expires
   *
   * @param groupSubId - Group subscription ID
   */
  async cancelGroupSubscription(groupSubscriptionId: number): Promise<GroupSubscription> {
    const groupSubscription = await GroupSubscription.findOrFail(groupSubscriptionId)

    // 1.  Call Dodo to cancel at next billing date
    await this.dodoPaymentService.cancelSubscription(groupSubscription.dodoSubscriptionId, true)

    // TODO in worker: Update group subscription membership status on subscription.cancelled.

    logger.info('Group subscription cancelled', {
      groupSubscriptionId,
      dodoSubscriptionId: groupSubscription.dodoSubscriptionId,
      expiresAt: groupSubscription.expiresAt.toISO(),
      message: 'All members will retain access until expiry date',
    })

    return groupSubscription
  }

  /**
   * Regenerate invite code for group subscription
   * Old code becomes invalid, new code expires in 30 days
   * Try generating random code up to 10 times if it is unique, save and return it, if it is not throw an error.
   * @param groupSubId - Group subscription ID
   */
  async regenerateInviteCode(
    groupSubscriptionId: number,
    requestingUserId: number
  ): Promise<string> {
    return await db.transaction(async (trx) => {
      const groupSubscription = await GroupSubscription.query({ client: trx })
        .where('id', groupSubscriptionId)
        .forUpdate()
        .firstOrFail()

      if (groupSubscription.ownerUserId !== requestingUserId) {
        throw new ActionDeniedException('Only the owner can regenerate the invite code')
      }

      const newInviteCode = await this.generateInviteCode()
      const newInviteCodeExpiresAt = DateTime.now().plus({ days: 30 })

      await groupSubscription
        .useTransaction(trx)
        .merge({ inviteCode: newInviteCode, inviteCodeExpiresAt: newInviteCodeExpiresAt })
        .save()

      logger.info('Invite code regenerated', {
        groupSubscriptionId,
        newInviteCode,
        requestedBy: requestingUserId,
      })

      return newInviteCode
    })
  }

  /**
   * Get available seats in group subscription
   *
   * @param groupSubId - Group subscription ID
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
   * Get group subscription owned by user
   * Returns null if user doesn't own any active group subscription
   * @params userId: number
   */
  async getOwnedGroupSubscription(userId: number): Promise<GroupSubscription | null> {
    return await GroupSubscription.query()
      .where('owner_user_id', userId)
      .where('status', 'active')
      .where('expires_at', '>', DateTime.now().toSQL())
      .first()
  }
}

// TODO: When subscription expires (via webhook):
// 1. Mark as expired and enforce 7-day grace periods via handleSubscriptionExpired()
// 2. Create in-app notification
// 3. downgrade to 'free' if they don't subscribe individually within 7 days
