import User from '#models/user'
import Photo from '#models/photo'
import HiddenGem from '#models/hidden_gem'
import IndividualSubscription from '#models/individual_subscription'
import GroupSubscription from '#models/group_subscription'
import GracePeriod from '#models/grace_period'
import TierAuditLog from '#models/tier_audit_log'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import GroupSubscriptionMember from '#models/group_subscription_member'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import ShareGroup from '#models/share_group'
import ShareGroupMember from '#models/share_group_member'
import SharedGem from '#models/shared_gem'

type UserTier = 'free' | 'individual_paid' | 'group_paid'

interface TierCalculationResult {
  tier: UserTier
  source: 'group_membership' | 'individual_subscription' | 'grace_period' | 'default'
  details?: string
}

export default class TierService {
  private async getUserActiveGroupCount(userId: number): Promise<number> {
    const result = await ShareGroupMember.query()
      .where('user_id', userId)
      .where('status', 'active')
      .whereHas('shareGroup', (groupQuery) => {
        groupQuery.where('status', 'active')
      })
      .count('* as total')

    return Number(result[0].$extras.total)
  }

  getTierLimits(tier: string) {
    const limits = {
      free: {
        maxPhotosPerGem: 1,
        maxGemsTotal: 3,
        canShare: true,
        maxShareGroups: 1,
        maxMembersPerGroup: 3,
        maxSharedGemsPerGroup: 3,
        maxFileSize: 2 * 1024 * 1024,
      },
      individual_paid: {
        maxPhotosPerGem: 20,
        maxGemsTotal: 1000,
        canShare: true,
        maxShareGroups: 1000,
        maxMembersPerGroup: 20,
        maxSharedGemsPerGroup: 1000,
        maxFileSize: 10 * 1024 * 1024,
      },
      group_paid: {
        maxPhotosPerGem: 20,
        maxGemsTotal: 1000,
        canShare: true,
        maxShareGroups: 1000,
        maxMembersPerGroup: 20,
        maxSharedGemsPerGroup: 1000,
        maxFileSize: 10 * 1024 * 1024,
      },
    }
    return limits[tier as keyof typeof limits] || limits.free
  }

  validateFileSize(fileSize: number, tier: string): { isValid: boolean; error?: string } {
    const limits = this.getTierLimits(tier)
    const maxSize = limits.maxFileSize

    if (fileSize > maxSize) {
      const maxSizeMB = (maxSize / 1024 / 1024).toFixed(1)
      return {
        isValid: false,
        error: `File size exceeds your tier limit of ${maxSizeMB}MB`,
      }
    }

    return { isValid: true }
  }

  /**
   * Check if user can add photos bases on tier limits set in limits object.
   *
   */
  async canCreateGem(
    userId: number
  ): Promise<{ canCreate: boolean; currentCount: number; limit: number; message?: string }> {
    const user = await User.findOrFail(userId)
    const limits = this.getTierLimits(user.tier)

    const currentGemCount = await HiddenGem.query().where('user_id', userId).count('* as total')
    const currentCount = Number(currentGemCount[0].$extras.total)

    if (currentCount >= limits.maxGemsTotal) {
      return {
        canCreate: false,
        currentCount,
        limit: limits.maxGemsTotal,
        message: `Gem limit reached. ${user.tier} tier allows maximum ${limits.maxGemsTotal} gems`,
      }
    }
    return {
      canCreate: true,
      currentCount,
      limit: limits.maxGemsTotal,
    }
  }

  /**
   * Check if user can add photos based on tier limits set in limits object.
   *
   */
  async canAddPhotosToGem(
    userId: number,
    gemId: number,
    photosToAdd: number
  ): Promise<{ canAdd: boolean; currentCount: number; limit: number; message?: string }> {
    const user = await User.findOrFail(userId)
    const limits = this.getTierLimits(user.tier)

    let currentCount = 0

    if (gemId > 0) {
      const currentPhotoCount = await Photo.query()
        .where('hidden_gem_id', gemId)
        .count('* as total')

      currentCount = Number(currentPhotoCount[0].$extras.total)
    }
    const wouldExceedLimit = currentCount + photosToAdd > limits.maxPhotosPerGem

    if (wouldExceedLimit) {
      return {
        canAdd: false,
        currentCount,
        limit: limits.maxPhotosPerGem,
        message: `Photo limit reached, ${user.tier} tier allows maximum ${limits.maxPhotosPerGem} photo per gem.`,
      }
    }
    return {
      canAdd: true,
      currentCount,
      limit: limits.maxPhotosPerGem,
    }
  }

  async getUpgrageMessage(userTier: string, feature: string) {
    if (userTier === 'free') {
      return `Upgrade to Individual or Group Paid Plan to unlock ${feature}`
    }
  }

  async canCreateShareGroup(userId: number): Promise<{ canCreate: boolean; message?: string }> {
    const user = await User.findOrFail(userId)
    const limits = this.getTierLimits(user.tier)

    const currentCount = await this.getUserActiveGroupCount(userId)

    if (currentCount >= limits.maxShareGroups) {
      return {
        canCreate: false,
        message: `Limit reached. You are already in ${currentCount} share group. Upgrade to create more.`,
      }
    }
    return { canCreate: true }
  }

  async canJoinShareGroup(
    user: User,
    shareGroup: ShareGroup
  ): Promise<{ canJoin: boolean; message?: string }> {
    const limits = this.getTierLimits(user.tier)

    const userGroupCount = await this.getUserActiveGroupCount(user.id)

    if (userGroupCount >= limits.maxShareGroups) {
      return {
        canJoin: false,
        message: `Limit reached. You are already in ${userGroupCount} share group. Upgrade to join more.`,
      }
    }

    const groupMemberCount = await ShareGroupMember.query()
      .where('share_group_id', shareGroup.id)
      .where('status', 'active')
      .count('* as total')

    const currentMembers = Number(groupMemberCount[0].$extras.total)

    if (currentMembers >= shareGroup.maxMembers) {
      return {
        canJoin: false,
        message: 'Share group is at maximum capacity.',
      }
    }

    return { canJoin: true }
  }

  async getMaxShareGroups(userId: number): Promise<{ maxGroups: number }> {
    const user = await User.findOrFail(userId)
    const limits = this.getTierLimits(user.tier)

    return {
      maxGroups: limits.maxShareGroups,
    }
  }

  async getMaxMembersPerGroup(userId: number): Promise<{ maxMembers: number }> {
    const user = await User.findOrFail(userId)
    const limits = this.getTierLimits(user.tier)

    return {
      maxMembers: limits.maxMembersPerGroup,
    }
  }

  async canShareGemsToGroup(
    userId: number,
    shareGroupId: number,
    gemsToAdd: number
  ): Promise<{ canShare: boolean; currentCount: number; limit: number; message?: string }> {
    const user = await User.findOrFail(userId)
    const limits = this.getTierLimits(user.tier)

    const currentSharedCount = await SharedGem.query()
      .where('shared_by', userId)
      .where('share_group_id', shareGroupId)
      .count('* as total')

    const currentCount = Number(currentSharedCount[0].$extras.total)

    if (currentCount + gemsToAdd > limits.maxSharedGemsPerGroup) {
      return {
        canShare: false,
        currentCount,
        limit: limits.maxSharedGemsPerGroup,
        message: `Sharing limit reached. ${user.tier} tier allows maximum ${limits.maxSharedGemsPerGroup} shared gems per group.`,
      }
    }

    return {
      canShare: true,
      currentCount,
      limit: limits.maxSharedGemsPerGroup,
    }
  }

  async calculateEffectiveTier(
    userId: number,
    trx?: TransactionClientContract
  ): Promise<TierCalculationResult> {
    // Check subscription in a priority basis group > individual > grace period > free
    const groupSubscriptionMembership = await GroupSubscriptionMember.query({ client: trx })
      .where('user_id', userId)
      .where('status', 'active')
      .whereHas('groupSubscription', (query) => {
        query
          .whereIn('status', ['active', 'cancelled'])
          .where('expires_at', '>', DateTime.now().toSQL())
      })
      .preload('groupSubscription')
      .first()

    if (groupSubscriptionMembership) {
      return {
        tier: 'group_paid',
        source: 'group_membership',
        details: `Active member of group subscription ${groupSubscriptionMembership.groupSubscription.dodoSubscriptionId}`,
      }
    }

    const individualSubscription = await IndividualSubscription.query({ client: trx })
      .where('user_id', userId)
      .whereIn('status', ['active', 'cancelled'])
      .where('expires_at', '>', DateTime.now().toSQL())
      .first()

    if (individualSubscription) {
      return {
        tier: 'individual_paid',
        source: 'individual_subscription',
        details: `Active individual subscription ${individualSubscription.dodoSubscriptionId}`,
      }
    }

    const gracePeriod = await GracePeriod.query({ client: trx })
      .where('user_id', userId)
      .where('resolved', false)
      .where('expires_at', '>', DateTime.now().toSQL())
      .first()

    if (gracePeriod) {
      return {
        tier: gracePeriod.originalTier,
        source: 'grace_period',
        details: `Grace period (${gracePeriod.type}) until ${gracePeriod.expiresAt.toISO()}`,
      }
    }

    return {
      tier: 'free',
      source: 'default',
      details: 'No active subscriptions or grace periods',
    }
  }

  /**
   * Update user's tier and log the change to audit trail
   * @param userId - User ID to update
   * @param reason - Human-readable reason for tier change
   * @param triggeredBy - System component that triggered the change
   * @param metadata - Additional context for the change
   * @param trx - Optional database transaction for atomic operations
   */
  async updateUserTier(
    userId: number,
    reason: string,
    triggeredBy: 'webhook' | 'manual' | 'cron' | 'join' | 'leave',
    trx: TransactionClientContract,
    metadata?: Record<string, any>
  ): Promise<void> {
    const user = await User.findOrFail(userId)
    const oldTier = user.tier

    // 1. calc effective tier using the calculateEffectiveTier method.
    const tierResult = await this.calculateEffectiveTier(userId, trx)
    const newTier = tierResult.tier

    // 2. only update tier if user wants to change tier
    if (oldTier === newTier) {
      logger.info('Tier unchanged for user', {
        userId,
        tier: oldTier,
        reason,
        triggeredBy,
      })
      return
    }

    await user.useTransaction(trx).merge({ tier: newTier, tierUpdatedAt: DateTime.now() }).save()

    await TierAuditLog.create(
      {
        userId,
        oldTier,
        newTier,
        reason,
        triggeredBy,
        metadata: {
          ...metadata,
          source: tierResult.source,
          details: tierResult.details,
        },
      },
      { client: trx }
    )

    logger.info('User tier updated', {
      userId,
      oldTier,
      newTier,
      reason,
      triggeredBy,
    })
  }

  /**
   * Detect and report tier conflicts
   * Used to prevent creating conflicting subscriptions before they're created
   * @param userId - User to check
   * @returns Object with conflict status and details
   */

  async detectTierConflict(
    userId: number,
    trx?: TransactionClientContract
  ): Promise<{
    hasConflict: boolean
    conflictType?: 'has_individual' | 'has_group_membership' | 'has_group_ownership'
    message?: string
    details?: any
  }> {
    const individualSubscription = await IndividualSubscription.query({ client: trx })
      .where('user_id', userId)
      .whereIn('status', ['active', 'cancelled'])
      .where('expires_at', '>', DateTime.now().toSQL())
      .first()

    const groupSubscriptionMembership = await GroupSubscriptionMember.query({ client: trx })
      .where('user_id', userId)
      .where('status', 'active')
      .whereHas('groupSubscription', (query) => {
        query
          .whereIn('status', ['active', 'cancelled'])
          .where('expires_at', '>', DateTime.now().toSQL())
      })
      .first()

    const ownedGroupSubscription = await GroupSubscription.query({ client: trx })
      .where('owner_user_id', userId)
      .whereIn('status', ['active', 'cancelled'])
      .where('expires_at', '>', DateTime.now().toSQL())
      .first()

    if (individualSubscription) {
      return {
        hasConflict: true,
        conflictType: 'has_individual',
        message: `Cannot join or create group subscription while you have an active individual subscription. Let it expire (expires ${individualSubscription.expiresAt.toFormat('LLL dd, yyyy')}) first.`,
        details: {
          individualSubscriptionId: individualSubscription.dodoSubscriptionId,
          individualExpiresAt: individualSubscription.expiresAt.toISO(),
          planType: individualSubscription.planType,
        },
      }
    }

    if (groupSubscriptionMembership) {
      return {
        hasConflict: true,
        conflictType: 'has_group_membership',
        message: `Cannot subscribe to individual plan while you're a member of a group subscription. Ask the owner to remove you first.`,
        details: {
          groupMembershipId: groupSubscriptionMembership.id,
          groupSubscriptionId: groupSubscriptionMembership.groupSubscriptionId,
        },
      }
    }

    if (ownedGroupSubscription) {
      return {
        hasConflict: true,
        conflictType: 'has_group_ownership',
        message: `Cannot subscribe to individual plan while you own a group subscription. Cancel your group subscription (expires ${ownedGroupSubscription.expiresAt.toFormat('LLL dd, yyyy')}) first.`,
        details: {
          ownedGroupSubscriptionId: ownedGroupSubscription.dodoSubscriptionId,
          groupExpiresAt: ownedGroupSubscription.expiresAt.toISO(),
          totalSeats: ownedGroupSubscription.totalSeats,
        },
      }
    }

    return { hasConflict: false }
  }

  async canJoinGroupSubscription(
    userId: number,
    trx: TransactionClientContract
  ): Promise<{
    canJoin: boolean
    reason?: string
  }> {
    // subscription tier validation 1: Check if user can join a group subscription & block if user has active individual subscription
    const conflict = await this.detectTierConflict(userId, trx)

    if (conflict.hasConflict && conflict.conflictType === 'has_individual') {
      return {
        canJoin: false,
        reason: conflict.message,
      }
    }

    return { canJoin: true }
  }

  async canCreateGroupSubscription(
    userId: number,
    trx?: TransactionClientContract
  ): Promise<{
    canCreate: boolean
    reason?: string
  }> {
    // 1. subscription tier validation 2: Check if user can create a group subscription (as owner) and block if user has active individual subscription
    const conflict = await this.detectTierConflict(userId, trx)

    if (!conflict.hasConflict) {
      return { canCreate: true }
    }

    // Default to the detectTierConflict message
    let reason = conflict.message

    if (conflict.conflictType === 'has_group_membership') {
      reason =
        'You cannot create a new group subscription while you are a member of another group. Please leave your current group first.'
    } else if (conflict.conflictType === 'has_group_ownership') {
      reason = 'You already own an active group subscription.'
    }

    return {
      canCreate: false,
      reason: reason,
    }
  }

  async canSubscribeIndividual(
    userId: number,
    trx?: TransactionClientContract
  ): Promise<{
    canSubscribe: boolean
    reason?: string
  }> {
    const conflict = await this.detectTierConflict(userId, trx)

    if (conflict.hasConflict) {
      return {
        canSubscribe: false,
        reason: conflict.message,
      }
    }

    return {
      canSubscribe: true,
    }
  }
}
