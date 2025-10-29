import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import GroupSubscription from '#models/group_subscription'
import GroupSubscriptionMember from '#models/group_subscription_member'
import { customAlphabet } from 'nanoid'
import User from '#models/user'
import TierService from './tier_service.js'
import { GracePeriodService } from './grace_period_service.js'
import { type CreateGroupSubscriptionParams, DodoPaymentService } from './dodo_payment_service.js'
import type { SubscriptionCreateResponse } from 'dodopayments/resources/subscriptions.mjs'

type PlanType = 'monthly' | 'quarterly' | 'annual'
type SubscriptionStatus = 'active' | 'cancelled' | 'expired'

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
  ): Promise<{ subscription: GroupSubscription; paymentLink: string | null | undefined }> {
    return await db.transaction(async (trx) => {
      // 1. call dodo api create sub endpoint
      logger.info('Creating group subscription with Dodo', {
        ownerUserId,
        totalSeats: params.addons[0].quantity,
        productId: params.productId,
      })
      const dodoResponse = await this.dodoPaymentService.createGroupSubscription(params)

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
      return { subscription, paymentLink: dodoResponse.payment_link }
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

      // TODO - handle the duplicate 23505 error code in controller.
      await GroupSubscriptionMember.create(
        {
          groupSubscriptionId: groupSubscription.id,
          userId,
          joinedAt: DateTime.now(),
          status: 'active',
        },
        { client: trx }
      )

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
  async removeMemberFromGroup(
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
        throw new Error('Only the owner can remove members from the group')
      }

      if (groupSubscription.ownerUserId === userIdToRemove) {
        throw new Error('Owner cannot remove themselves. Dissolve the group instead.')
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
      // TODO: error handling in controller
    })
  }

  /**
   * Expand seats for group subscription (mid-cycle increase)
   * Prorated charge applied immediately by Dodo Payments
   *
   * @param groupSubId - Group subscription ID
   * @param newQuantity - New total seat count
   */
  async expandSeats(groupSubscriptionId: number, newQuantity: number): Promise<GroupSubscription> {
    const groupSub = await GroupSubscription.findOrFail(groupSubscriptionId)
    // 1. Validate new quantity is greater than current
    if (newQuantity > groupSub.totalSeats) {
      throw new Error(
        `New seat count (${newQuantity}) must be greater than current seats (${groupSub.totalSeats})`
      )
    }

    // 2. Validate seat count within limits
    if (newQuantity > 50) {
      throw new Error('Maximum 50 seats allowed per group subscription')
    }

    return await db.transaction(async (trx) => {
      // 3. Call Dodo endpoint change_plan_subscriptions with new quantity

      await this.dodoPaymentService.changeSubscriptionPlan({
        subscriptionId: groupSub.dodoSubscriptionId,
        newProductId: groupSub.dodoSubscriptionId,
        quantity: 1,
        prorationBillingMode: 'prorated_immediately',
      })

      // 4. Update seat count
      const oldSeats = groupSub.totalSeats
      groupSub.useTransaction(trx)
      groupSub.totalSeats = newQuantity
      await groupSub.save()

      logger.info('Group subscription seats expanded', {
        groupSubId,
        dodoSubscriptionId: groupSub.dodoSubscriptionId,
        oldSeats,
        newSeats: newQuantity,
        addedSeats: newQuantity - oldSeats,
      })

      return groupSub
    })
  }

  /**
   * Reduce seats for group subscription (mid-cycle decrease)
   * Blocked if new quantity < current member count
   *
   * @param groupSubId - Group subscription ID
   * @param newQuantity - New total seat count
   */
  async reduceSeats(groupSubId: number, newQuantity: number): Promise<GroupSubscription> {
    const groupSub = await GroupSubscription.findOrFail(groupSubId)

    // 1. Validate new quantity is less than current
    if (newQuantity >= groupSub.totalSeats) {
      throw new Error(
        `New seat count (${newQuantity}) must be less than current seats (${groupSub.totalSeats})`
      )
    }

    // 2. Validate minimum seats (at least owner)
    if (newQuantity < 1) {
      throw new Error('Minimum 1 seat required (for owner)')
    }

    return await db.transaction(async (trx) => {
      // 3. Lock subscription and count active members
      const lockedSub = await GroupSubscription.query({ client: trx })
        .where('id', groupSubId)
        .forUpdate()
        .firstOrFail()

      const currentMembers = await GroupSubscriptionMember.query({ client: trx })
        .where('group_subscription_id', lockedSub.id)
        .where('status', 'active')
        .count('* as total')

      const activeMemberCount = Number(currentMembers[0].$extras.total)

      // 4. Block if new quantity < current member count
      if (newQuantity < activeMemberCount) {
        throw new Error(
          `Cannot reduce seats to ${newQuantity}. You currently have ${activeMemberCount} active members. Remove members first.`
        )
      }

      // 5. Call Dodo API change plan subscriptions with new quantity

      await this.dodoPaymentService.changeSubscriptionPlan({
        subscriptionId: lockedSub.dodoSubscriptionId,
        newProductId: lockedSub.dodoSubscriptionId,
        quantity: newQuantity,
        prorationBillingMode: 'prorated_immediately',
      })

      // 6. Update seat count
      const oldSeats = lockedSub.totalSeats
      lockedSub.totalSeats = newQuantity
      await lockedSub.save()

      logger.info('Group subscription seats reduced', {
        groupSubId,
        dodoSubscriptionId: lockedSub.dodoSubscriptionId,
        oldSeats,
        newSeats: newQuantity,
        removedSeats: oldSeats - newQuantity,
        activeMemberCount,
      })

      return lockedSub
    })
  }

  /**
   * Cancel group subscription (cancel_at_next_billing_date)
   * All members keep access until expiry
   * Grace periods start when subscription expires
   *
   * @param groupSubId - Group subscription ID
   */
  async cancelGroupSubscription(groupSubId: number): Promise<GroupSubscription> {
    const groupSub = await GroupSubscription.findOrFail(groupSubId)

    // 1.  Call Dodo to cancel at next billing date
    await this.dodoPaymentService.cancelSubscription(groupSub.dodoSubscriptionId, true)

    groupSub.status = 'cancelled'
    await groupSub.save()

    // NOTE When subscription expires (via webhook), all members will:
    // 1. Get 7-day grace periods via handleSubscriptionExpired()
    // 2. Receive email notifications
    // 3. Be downgraded to 'free' if they don't subscribe individually within 7 days

    logger.info('Group subscription cancelled', {
      groupSubId,
      dodoSubscriptionId: groupSub.dodoSubscriptionId,
      expiresAt: groupSub.expiresAt.toISO(),
      message: 'All members will retain access until expiry date',
    })

    return groupSub
  }

  /**
   * Regenerate invite code for group subscription
   * Old code becomes invalid, new code expires in 30 days
   * Try generating random code up to 10 times if it is unique, save and return it, if it is not throw an error.
   * @param groupSubId - Group subscription ID
   */
  async regenerateInviteCode(groupSubId: number): Promise<GroupSubscription> {
    return await db.transaction(async (trx) => {
      const groupSub = await GroupSubscription.query({ client: trx })
        .where('id', groupSubId)
        .firstOrFail()

      // Generate new unique code
      let inviteCode: string
      let collisions = 0
      let MAX_RETRIES = 10

      while (collisions < MAX_RETRIES) {
        inviteCode = this.generateInviteCode()

        const existing = await GroupSubscription.query({ client: trx })
          .where('invite_code', inviteCode)
          .whereNot('id', groupSubId)
          .first()

        if (!existing) {
          // unique code found
          const oldCode = groupSub.inviteCode
          groupSub.inviteCode = inviteCode
          groupSub.inviteCodeExpiresAt = this.calculateInviteCodeExpiry()
          await groupSub.save()

          logger.info('Group subscription invite code regenerated', {
            groupSubId,
            oldCode,
            newCode: inviteCode,
            collisions,
            expiresAt: groupSub.inviteCodeExpiresAt.toISO(),
          })
          return groupSub
        }

        collisions++
      }
      // If we get here, all 10 attempts failed
      throw new Error(
        `Failed to generate unique invite code after ${MAX_RETRIES} attempts. Please try again.`
      )
    })
  }

  /**
   * Get available seats in group subscription
   *
   * @param groupSubId - Group subscription ID
   * @returns Object with total, used, and available seats
   */
  async getAvailableSeats(groupSubId: number): Promise<{
    totalSeats: number
    usedSeats: number
    availableSeats: number
  }> {
    const groupSub = await GroupSubscription.findOrFail(groupSubId)

    const currentMembers = await GroupSubscriptionMember.query()
      .where('group_subscription_id', groupSubId)
      .where('status', 'active')
      .count('* as total')

    const usedSeats = Number(currentMembers[0].$extras.total)
    const availableSeats = groupSub.totalSeats - usedSeats

    return {
      totalSeats: groupSub.totalSeats,
      usedSeats,
      availableSeats,
    }
  }

  /**
   * Validate if user can join a group subscription
   * Checks for tier conflicts (active individual or group subscriptions)
   *
   * @param userId - User attempting to join
   * @returns Validation result with reason if blocked
   */
  async validateUserCanJoinGroup(userId: number): Promise<{
    canJoin: boolean
    reason?: string
  }> {
    const conflict = await this.tierService.detectTierConflict(userId)

    if (conflict.hasConflict) {
      return {
        canJoin: false,
        reason: conflict.message,
      }
    }

    return {
      canJoin: true,
    }
  }

  /**
   * Get active group subscription for user (as member)
   * Returns null if user is not a member of any active group
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
   */
  async getOwnedGroupSubscription(userId: number): Promise<GroupSubscription | null> {
    return await GroupSubscription.query()
      .where('owner_user_id', userId)
      .where('status', 'active')
      .where('expires_at', '>', DateTime.now().toSQL())
      .first()
  }

  /**
   * Handle payment success webhook from Dodo for group subscription
   * Extends expires_at for all members
   *
   * @param dodoSubscriptionId - Dodo subscription ID
   * @param eventId - Webhook event ID for logging/auditing
   */
  async handlePaymentSuccess(dodoSubscriptionId: string, eventId: string): Promise<void> {
    // 1. get sub
    const subscription = await GroupSubscription.query()
      .where('dodo_subscription_id', dodoSubscriptionId)
      .preload('owner')
      .preload('members')
      .firstOrFail()

    // 2. extend expiry date
    subscription.expiresAt = this.calculateExpiresAt(subscription.planType)
    subscription.status = 'active'
    await subscription.save()

    // 3. update tier for all members
    const activeMembers = subscription.members.filter((m) => m.status === 'active')

    for (const member of activeMembers) {
      await this.gracePeriodService.clearGracePeriod(member.userId)

      // 4. update tier
      await this.tierService.updateUserTier(
        member.userId,
        'Group subscription payment successful',
        'webhook',
        {
          groupSubscriptionId: subscription.id,
          dodoSubscriptionId,
          eventId,
          expiresAt: subscription.expiresAt.toISO(),
        }
      )
    }

    logger.info('Group subscription payment successful', {
      ownerId: subscription.ownerUserId,
      subscriptionId: subscription.id,
      dodoSubscriptionId,
      eventId,
      memberCount: activeMembers.length,
      newExpiresAt: subscription.expiresAt.toISO(),
    })
  }

  /**
   * Handle payment failure webhook from Dodo for group subscription
   * Starts 3-day grace period for owner (not all members)
   *
   * @param dodoSubscriptionId - Dodo subscription ID
   * @param eventId - Webhook event ID for logging/auditing
   */
  async handlePaymentFailure(dodoSubscriptionId: string, eventId: string): Promise<void> {
    // 1. get sub
    const subscription = await GroupSubscription.query()
      .where('dodo_subscription_id', dodoSubscriptionId)
      .preload('owner')
      .firstOrFail()

    // 2. Start 3-day grace period for owner. Members keep access during grace period
    await this.gracePeriodService.startGracePeriod(
      subscription.ownerUserId,
      'payment_failure',
      'group_paid'
    )

    logger.warn('Group subscription payment failed - grace period started', {
      ownerId: subscription.ownerUserId,
      subscriptionId: subscription.id,
      dodoSubscriptionId,
      eventId,
      expiresAt: subscription.expiresAt.toISO(),
    })

    // 3. TODO: Send email notification to owner about payment failure
    // await this.emailService.sendPaymentFailureEmail(subscription.owner.email)
  }

  /**
   * Handle subscription expired webhook from Dodo for group subscription
   * Marks subscription as expired and starts 7-day grace for all members
   *
   * @param dodoSubscriptionId - Dodo subscription ID
   * @param eventId - Webhook event ID for logging/auditing
   */
  async handleSubscriptionExpired(dodoSubscriptionId: string, eventId: string): Promise<void> {
    // 1. get sub
    const subscription = await GroupSubscription.query()
      .where('dodo_subscription_id', dodoSubscriptionId)
      .preload('members')
      .firstOrFail()

    // 2. mark sub as expired
    subscription.status = 'expired'
    await subscription.save()

    // 3. Start 7-day grace period for all active members
    const activeMembers = subscription.members.filter((m) => m.status === 'active')

    for (const member of activeMembers) {
      await this.gracePeriodService.startGracePeriod(member.userId, 'group_removal', 'group_paid')

      // 4. Update member status to removed
      member.status = 'removed'
      await member.save()

      logger.info('Group subscription expired - member removed with grace period', {
        userId: member.userId,
        groupSubscriptionId: subscription.id,
        eventId,
      })
    }

    logger.info('Group subscription expired - all members in grace period', {
      subscriptionId: subscription.id,
      dodoSubscriptionId,
      eventId,
      memberCount: activeMembers.length,
    })

    // TODO: Send email notifications to all members
    // for (const member of activeMembers) {
    //   await this.emailService.sendGroupSubscriptionExpiredEmail(member.user.email)
    // }
  }
  /**
   * Handle subscription renewal (same as payment success)
   *
   * @param dodoSubscriptionId - Dodo subscription ID
   * @param eventId - Webhook event ID for logging/auditing
   */
  async handleSubscriptionRenewed(dodoSubscriptionId: string, eventId: string): Promise<void> {
    await this.handlePaymentSuccess(dodoSubscriptionId, eventId)
  }
}
