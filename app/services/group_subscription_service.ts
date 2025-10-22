import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import GroupSubscription from '#models/group_subscription'
import GroupSubscriptionMember from '#models/group_subscription_member'
import User from '#models/user'
import TierService from './tier_service.js'

type PlanType = 'monthly' | 'quarterly' | 'annual'
type SubscriptionStatus = 'active' | 'cancelled' | 'expired'

interface BillingAddress {
  street: string
  city: string
  state: string
  zipcode: string
  country: string
}

interface CustomerData {
  email: string
  name: string
  phone_number?: string
}

@inject()
export class GroupSubscriptionService {
  constructor(protected tierService: TierService) {}

  /**
   * Generate 8-character alphanumeric invite code
   * Format: Uppercase letters and numbers only (e.g., XK94PL72)
   */
  private generateInviteCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let code = ''
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return code
  }

  /**
   * Calculate expiry date based on plan type
   */
  private calculateExpiresAt(planType: PlanType): DateTime {
    const now = DateTime.now()
    switch (planType) {
      case 'monthly':
        return now.plus({ months: 1 })
      case 'quarterly':
        return now.plus({ months: 3 })
      case 'annual':
        return now.plus({ years: 1 })
      default:
        throw new Error(`Invalid plan type: ${planType}`)
    }
  }

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
    ownerId: number,
    planType: PlanType,
    totalSeats: number,
    productId: string,
    billingAddress: BillingAddress,
    customer: CustomerData
  ): Promise<{ subscription: GroupSubscription; paymentUrl?: string }> {
    const owner = await User.findOrFail(ownerId)

    // 1. check if the owner can create a group subscription(no active individual)
    const canCreate = await this.tierService.canCreateGroupSubscription(ownerId)
    if (!canCreate.canCreate) {
      throw new Error(canCreate.reason)
    }

    // 2. check total seats
    if (totalSeats < 2 || totalSeats > 50) {
      throw new Error('Total seats must be between 2 and 50')
    }

    // 3. Check if owner already owns an active group subscription
    const existingOwned = await GroupSubscription.query()
      .where('owner_user_id', ownerId)
      .where('status', 'active')
      .first()
    if (existingOwned) {
      throw new Error('You already own an active group subscription')
    }

    return await db.transaction(async (trx) => {
      // 4. generate a unique invite code
      let inviteCode: string
      let collisions = 0
      const MAX_RETRIES = 10

      while (collisions < MAX_RETRIES) {
        inviteCode = this.generateInviteCode()

        const existing = await GroupSubscription.query({ client: trx })
          .where('invite_code', inviteCode)
          .first()

        if (!existing) {
          break
        }
        collisions++
      }
      if (collisions === MAX_RETRIES) {
        throw new Error(
          `Failed to generate unique invite code after ${MAX_RETRIES} attempts. Please try again.`
        )
      }

      // 5. Call Dodo Payment's create_subscriptions api endpoint

      // 6. create group_subscription record
      const subscription = await GroupSubscription.create(
        {
          ownerUserId: ownerId,
          // dodoSubscriptionId: dodoResponse.subscription_id,
          totalSeats,
          inviteCode: inviteCode!,
          inviteCodeExpiresAt: this.calculateInviteCodeExpiry(),
          status: 'active',
          expiresAt: this.calculateExpiresAt(planType),
        },
        { client: trx }
      )

      // 7. Create owner membership (owner is always the first member)
      await GroupSubscriptionMember.create(
        {
          groupSubscriptionId: subscription.id,
          userId: ownerId,
          joinedAt: DateTime.now(),
          status: 'active',
        },
        { client: trx }
      )

      // 8. Update owner's tier
      await this.tierService.updateUserTier(
        ownerId,
        `Created group ${planType} subscription with ${totalSeats} seats`,
        'manual',
        {
          subscriptionId: subscription.id,
          // dodoSubscriptionId: dodoResponse.subscription_id,
          totalSeats,
        },
        trx
      )
      logger.info('Group subscription created', {
        ownerId,
        subscriptionId: subscription.id,
        // dodoSubscriptionId: dodoResponse.subscription_id,
        planType,
        totalSeats,
      })

      return {
        subscription,
        // paymentUrl: dodoResponse.payment_link,
      }
    })
  }

  /**
   * User joins group subscription via invite code
   * Validates code, seat availability, and tier conflicts
   *
   * @param userId - User joining the group
   * @param inviteCode - 8-character invite code
   */
  async joinGroupSubscription(userId: number, inviteCode: string): Promise<GroupSubscription> {
    const user = await User.findOrFail(userId)

    // 1. Validate user can join (no active individual subscription)

    const canJoin = await this.tierService.canJoinGroupSubscription(userId)
    if (!canJoin.canJoin) {
      throw new Error(canJoin.reason)
    }

    // 2. Find group subscription by invite code
    const groupSub = await GroupSubscription.query()
      .where('invite_code', inviteCode.toUpperCase())
      .where('status', 'active')
      .where('expires_at', '>', DateTime.now().toSQL())
      .first()
    if (!groupSub) {
      throw new Error('Invalid or expired invite code')
    }

    // 3. Check invite code expiry
    if (groupSub.inviteCodeExpiresAt > DateTime.now()) {
      throw new Error('This invite code has expired. Ask the owner to generate another one.')
    }

    return await db.transaction(async (trx) => {
      // 4. Lock subscription row and check seat availability
      const lockedSub = await GroupSubscription.query({ client: trx })
        .where('id', groupSub.id)
        .forUpdate()
        .firstOrFail()

      const currentMembers = await GroupSubscriptionMember.query({ client: trx })
        .where('group_subscription_id', lockedSub.id)
        .where('status', 'active')
        .count('* as total')

      const activeMemberCount = Number(currentMembers[0].$extras.total)
      if (activeMemberCount >= lockedSub.totalSeats) {
        throw new Error('This group subscription is full. No available seats.')
      }

      // 5. Check if user already has membership (active or removed)
      const existingMembership = await GroupSubscriptionMember.query({ client: trx })
        .where('group_subscription_id', lockedSub.id)
        .where('user_id', userId)
        .first()
      if (existingMembership) {
        if (existingMembership.status === 'active') {
          throw new Error('You are already a member of this group')
        }
        // If status is 'removed', we can rejoin by updating status
        existingMembership.status = 'active'
        existingMembership.joinedAt = DateTime.now()
        await existingMembership.save()

        // TODO: - RESET GRACE PERIOD FOR THIS CASE
      } else {
        // 6. Create new membership
        await GroupSubscriptionMember.create(
          {
            groupSubscriptionId: lockedSub.id,
            userId,
            joinedAt: DateTime.now(),
            status: 'active',
          },
          { client: trx }
        )
      }
      // 7. Update user's tier
      await this.tierService.updateUserTier(
        userId,
        'Joined group subscription',
        'join',
        {
          groupSubscriptionId: lockedSub.id,
          dodoSubscriptionId: lockedSub.dodoSubscriptionId,
        },
        trx
      )

      logger.info('User joined group subscription', {
        userId,
        groupSubscriptionId: lockedSub.id,
        remainingSeats: lockedSub.totalSeats - activeMemberCount - 1,
      })

      return lockedSub
    })
  }

  /**
   * Remove member from group subscription
   * Starts 7-day grace period
   *
   * @param groupSubId - Group subscription ID
   * @param userId - User to remove
   */
  async removeMemberFromGroup(groupSubId: number, userId: number): Promise<void> {
    await db.transaction(async (trx) => {
      const membership = await GroupSubscriptionMember.query({ client: trx })
        .where('group_subscription_id', groupSubId)
        .where('user_id', userId)
        .where('status', 'active')
        .firstOrFail()

      // prevent owner of group from removing themselves
      const groupSub = await GroupSubscription.findOrFail(groupSubId)
      if (groupSub.ownerUserId === userId) {
        throw new Error('Owner cannot remove themselves. Cancel the subscription instead.')
      }

      membership.status = 'removed'
      await membership.save()

      // TODO Phase 5: Start 7-day grace period
      // await gracePeriodService.startGracePeriod(userId, 'group_removal', 'group_paid')
      logger.info('TODO Phase 5: Start 7-day grace period for removed member', {
        userId,
        groupSubId,
      })

      await this.tierService.updateUserTier(
        userId,
        'Removed from group subscription',
        'manual',
        { groupSubId },
        trx
      )

      logger.info('Member removed from group subscription', {
        userId,
        groupSubId,
        membershipId: membership.id,
      })
    })
  }

  /**
   * Expand seats for group subscription (mid-cycle increase)
   * Prorated charge applied immediately by Dodo
   *
   * @param groupSubId - Group subscription ID
   * @param newQuantity - New total seat count
   */
  async expandSeats(groupSubId: number, newQuantity: number): Promise<GroupSubscription> {
    const groupSub = await GroupSubscription.findOrFail(groupSubId)

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
      await this.callDodoChangePlan(groupSub.dodoSubscriptionId, {
        product_id: groupSub.dodoSubscriptionId, // Keep same product
        quantity: newQuantity,
        proration_billing_mode: 'prorated_immediately', // Charge difference now
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

      // 5. Call Dodo change_plan_subscriptions with new quantity
      await this.callDodoChangePlan(lockedSub.dodoSubscriptionId, {
        product_id: lockedSub.dodoSubscriptionId, // Keep same product
        quantity: newQuantity,
        proration_billing_mode: 'prorated_immediately', // Credit difference now
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

    // Call Dodo to cancel at next billing date
    await this.callDodoUpdateSubscription(groupSub.dodoSubscriptionId, {
      cancel_at_next_billing_date: true,
    })

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
}
