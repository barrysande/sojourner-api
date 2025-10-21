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

type UserTier = 'free' | 'individual_paid' | 'group_paid'

interface TierCalculationResult {
  tier: UserTier
  source: 'group_membership' | 'individual_subscription' | 'grace_period' | 'default'
  details?: string
}

export default class TierService {
  getTierLimits(tier: string) {
    const limits = {
      free: {
        maxPhotosPerGem: 1,
        maxGemsTotal: 3,
        canShare: false,
        maxShareGroups: 0,
        maxMembersPerGroup: 0,
        maxFileSize: 2 * 1024 * 1024, // 2MB
      },
      individual_paid: {
        maxPhotosPerGem: 3,
        maxGemsTotal: 500,
        canShare: true,
        maxShareGroups: 10,
        maxMembersPerGroup: 10,
        maxFileSize: 10 * 1024 * 1024, // 10MB
      },
      group_paid: {
        maxPhotosPerGem: 3,
        maxGemsTotal: 500,
        canShare: true,
        maxShareGroups: 10,
        maxMembersPerGroup: 10,
        maxFileSize: 10 * 1024 * 1024, // 10MB
      },
    }
    return limits[tier as keyof typeof limits] || limits.free
  }

  //Check if user can add photos bases on tier limits set in limits object.
  async canCreateGem(
    userId: number
  ): Promise<{ canCreate: boolean; currentCount: number; limit: number; message?: string }> {
    const user = await User.findOrFail(userId)
    const limits = this.getTierLimits(user.tier)

    // count the current gems i.e currentCount
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

  //Check if user can add photos based on tier limits set in limits object.
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
        message: `Photo limit reached. ${user.tier} tier allows maximum ${limits.maxPhotosPerGem} photos per gem.`,
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
      return `Upgrade to Individual Plan to unlock ${feature}`
    }
  }

  async canCreateShareGroup(userId: number): Promise<{ canCreate: boolean; message?: string }> {
    const user = await User.findOrFail(userId)
    const limits = this.getTierLimits(user.tier)

    if (!limits.canShare) {
      return {
        canCreate: false,
        message: `Upgrade from ${user.tier} to Individual Plan to share gems`,
      }
    }
    return {
      canCreate: true,
    }
  }

  async canJoinShareGroup(userId: number): Promise<{ canJoin: boolean; message?: string }> {
    const user = await User.findOrFail(userId)
    const limits = this.getTierLimits(user.tier)

    if (!limits.canShare) {
      return {
        canJoin: false,
        message: `Upgrade from ${user.tier} to the Individual Plan to join a share group`,
      }
    }
    return {
      canJoin: true,
    }
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

  async calculateEffectiveTier(userId: number): Promise<TierCalculationResult> {
    // Check subscription in a priority basis group > indibidual > grace period > free
    const groupSubscriptionMembership = await GroupSubscriptionMember.query()
      .where('user_id', userId)
      .where('status', 'active')
      .whereHas('groupSubscription', (query) => {
        query.where('status', 'active').where('expires_at', '>', DateTime.now().toSQL())
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

    const individualSubscription = await IndividualSubscription.query()
      .where('user_id', userId)
      .where('status', 'active')
      .where('expires_at', '>', DateTime.now().toSQL())
      .first()

    if (individualSubscription) {
      return {
        tier: 'individual_paid',
        source: 'individual_subscription',
        details: `Active individual subscription ${individualSubscription.dodoSubscriptionId}`,
      }
    }

    const gracePeriod = await GracePeriod.query()
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
   */

  async updateUserTier(
    userId: number,
    reason: string,
    triggeredBy: 'webhook' | 'manual' | 'cron' | 'join' | 'leave',
    metadata?: Record<string, any>
  ): Promise<void> {
    const user = await User.findOrFail(userId)
    const oldTier = user.tier

    // calc effective tier using the calculateEffectiveTier method.
    const tierResult = await this.calculateEffectiveTier(userId)
    const newTier = tierResult.tier

    // only update tier if user wants to change tier
    if (oldTier === newTier) {
      logger.info('Tier unchanged for user', {
        userId,
        tier: oldTier,
        reason,
        triggeredBy,
      })
      return
    }

    user.tier = newTier
    user.tierUpdatedAt = DateTime.now()
    user.save()

    await TierAuditLog.create({
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
    })

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

  async detectTierConflict(userId: number): Promise<{
    hasConflict: boolean
    conflictType?: 'has_individual' | 'has_group_membership' | 'has_group_ownership'
    message?: string
    details?: any
  }> {
    const individualSubscription = await IndividualSubscription.query()
      .where('user_id', userId)
      .where('status', 'active')
      .where('expires_at', '>', DateTime.now().toSQL())
      .first()

    const groupSubscriptionMembership = await GroupSubscriptionMember.query()
      .where('user_id', userId)
      .where('status', 'active')
      .whereHas('groupSubscription', (query) => {
        query.where('status', 'active').where('expires_at', '>', DateTime.now().toSQL())
      })
      .first()

    // check if the user owns a group subscription
    const ownedGroupSubscription = await GroupSubscription.query()
      .where('owner_user_id', userId)
      .where('status', 'active')
      .where('expires_at', '>', DateTime.now().toSQL())
      .first()

    if (individualSubscription) {
      return {
        hasConflict: true,
        conflictType: 'has_individual',
        message: `Cannot join or create group subscription while you have an active individual subscription. Cancel your individual subscription (expires ${individualSubscription.expiresAt.toFormat('LLL dd, yyyy')}) first.`,
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
        message: `Cannot subscribe to individual plan while you're a member of a group subscription. Leave the group first.`,
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

  // subscription tier validation 1: Check if user can join a group subscription & block if user has active individual subscription
  async canJoinGroupSubscription(userId: number): Promise<{
    canJoin: boolean
    reason?: string
  }> {
    const conflict = await this.detectTierConflict(userId)

    if (conflict.hasConflict && conflict.conflictType === 'has_individual') {
      return {
        canJoin: false,
        reason: conflict.message,
      }
    }

    return { canJoin: true }
  }

  // subscription tier validation 2: Check if user can create a group subscription (as owner) and block if user has active individual subscription
  async canCreateGroupSubscription(userId: number): Promise<{
    canCreate: boolean
    reason?: string
  }> {
    const conflict = await this.detectTierConflict(userId)

    if (conflict) {
      return {
        canCreate: false,
        reason: conflict.message,
      }
    }
    return {
      canCreate: true,
    }
  }

  // subscription tier validation 2: Check if user can create/subscribe to individual plan and block if user has active group membership or ownership
  async canSubscribeIndividual(userId: number): Promise<{
    canSubscribe: boolean
    reason?: string
  }> {
    const conflict = await this.detectTierConflict(userId)

    if (
      conflict.hasConflict &&
      (conflict.conflictType === 'has_group_membership' ||
        conflict.conflictType === 'has_group_ownership')
    ) {
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
