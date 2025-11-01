import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import GracePeriod from '#models/grace_period'
import User from '#models/user'
import HiddenGem from '#models/hidden_gem'
import Photo from '#models/photo'
import ShareGroupMember from '#models/share_group_member'
import TierService from '#services/tier_service'
import CloudinaryService from '#services/cloudinary_service'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'

type GracePeriodType = 'payment_failure' | 'group_removal'
type UserTier = 'free' | 'individual_paid' | 'group_paid'

@inject()
export class GracePeriodService {
  constructor(
    protected tierService: TierService,
    protected cloudinaryService: CloudinaryService
  ) {}
  /**
   * Calculate grace period duration based on type
   * - payment_failure: 3 days
   * - group_removal: 7 days
   */
  private calculateGracePeriodDuration(type: GracePeriodType): { days: number } {
    return type === 'payment_failure' ? { days: 3 } : { days: 7 }
  }

  /**
   * Delete all non-primary photos for user's gems
   * Keeps the first (primary) photo for each gem
   * Deletes from both Cloudinary and database
   *
   * @param userId - User whose photos to delete
   * @param trx - Database transaction
   * @returns Number of photos deleted
   */
  private async deleteNonPrimaryPhotos(
    userId: number,
    trx: TransactionClientContract
  ): Promise<number> {
    // 1. Get all user's gems with photos
    const gems = await HiddenGem.query({ client: trx })
      .where('user_id', userId)
      .forUpdate()
      .preload('photos', (query) => {
        query.where('is_primary', false)
      })

    let deletedCount = 0
    const cloudinaryPublicIds: string[] = []

    // 2. Get all non-primary cloudinary public ids
    for (const gem of gems) {
      for (const photo of gem.photos) {
        cloudinaryPublicIds.push(photo.cloudinaryPublicId)
        deletedCount++
      }
    }

    if (cloudinaryPublicIds.length === 0) {
      logger.info('No non-primary photos to delete', { userId })
      return 0
    }

    // 3. Bulk delete from Cloudinary
    const cloudinaryResult = await this.cloudinaryService.deleteMultipleImages(cloudinaryPublicIds)
    if (cloudinaryResult.failed.length > 0) {
      logger.warn('Some Cloudinary deletions failed during degradation', {
        userId,
        failed: cloudinaryResult.failed,
      })
    }

    // 4. Delete photos from database
    await Photo.query({ client: trx })
      .whereHas('hiddenGem', (query) => {
        query.where('user_id', userId)
      })
      .where('is_primary', false)
      .delete()
    logger.info('Non-primary photos deleted', {
      userId,
      deletedCount,
      cloudinarySuccess: cloudinaryResult.successful.length,
      cloudinaryFailed: cloudinaryResult.failed.length,
    })

    return deletedCount
  }

  /**
   * Lock gems over free tier limit (3 gems)
   * Keeps the first 3 gems by created_at, locks the rest
   * Locked gems remain in DB but user can't access them
   *
   * @param userId - User whose gems to lock
   * @param trx - Database transaction
   * @returns Number of gems locked
   */

  private async lockExcessGems(userId: number, trx: TransactionClientContract): Promise<number> {
    const freeTier = this.tierService.getTierLimits('free')
    const freeTierLimit = freeTier.maxGemsTotal

    // 1. get all user's gems in order by creation date
    const allGems = await HiddenGem.query({ client: trx })
      .where('user_id', userId)
      .orderBy('created_at', 'asc')
      .forUpdate()

    if (allGems.length <= freeTierLimit) {
      logger.info('User has no gems to lock', {
        userId,
        gemCount: allGems.length,
        limit: freeTierLimit,
      })
      return 0
    }

    // 2. show first 3 and lock the rest
    const gemsToKeep = allGems.slice(0, freeTierLimit)
    const gemsToLock = allGems.slice(freeTierLimit)

    // 3. Mark gems as locked
    for (const gem of gemsToLock) {
      gem.locked = true
      await gem.useTransaction(trx).merge({ locked: true }).save()
    }

    logger.info('Excess gems locked', {
      userId,
      totalGems: allGems.length,
      kept: gemsToKeep.length,
      locked: gemsToLock.length,
    })

    return gemsToLock.length
  }

  /**
   * Remove user from all share groups
   * Updates membership status to 'left'
   *
   * @param userId - User to remove from groups
   * @param trx - Database transaction
   * @returns Number of groups removed from
   */
  private async removeFromAllShareGroups(
    userId: number,
    trx: TransactionClientContract
  ): Promise<number> {
    const activeMemberships = await ShareGroupMember.query({ client: trx })
      .where('user_id', userId)
      .where('status', 'active')
      .forUpdate()

    for (const membership of activeMemberships) {
      await membership.useTransaction(trx).merge({ status: 'left' }).save()
    }

    logger.info('User removed from share groups', {
      userId,
      groupCount: activeMemberships.length,
    })

    return activeMemberships.length
  }

  /**
   * Start a grace period for a user
   * Only one active grace period allowed per user
   *
   * @param userId - User entering grace period
   * @param type - 'payment_failure' or 'group_removal'
   * @param originalTier - Tier user had before grace period 'free', or 'individual_paid', or 'group_paid'
   */
  async startGracePeriod(
    userId: number,
    type: GracePeriodType,
    originalTier: UserTier,
    trx: TransactionClientContract
  ): Promise<GracePeriod> {
    // 1. check for existing active grace period
    const existingGrace = await GracePeriod.query({ client: trx })
      .where('user_id', userId)
      .where('resolved', false)
      .forUpdate()
      .first()

    if (existingGrace) {
      logger.warn('User already has active grace period', {
        userId,
        existingType: existingGrace.type,
        requestedType: type,
      })
      throw new Error('User already has an active grace period')
    }

    // 2. Create grace period record if there is none
    const duration = this.calculateGracePeriodDuration(type)
    const startedAt = DateTime.now()
    const expiresAt = startedAt.plus(duration)

    const gracePeriod = await GracePeriod.create(
      {
        userId,
        type,
        originalTier,
        startedAt,
        expiresAt,
        resolved: false,
      },
      { client: trx }
    )

    logger.info('Grace period started', {
      userId,
      gracePeriodId: gracePeriod.id,
      type,
      originalTier,
      expiresAt: expiresAt.toISO(),
    })

    return gracePeriod
  }

  /**
   * Clear/resolve an active grace period for a user
   * Called when user resolves their payment issue or rejoins a group
   *
   * @param userId - User whose grace period to clear
   */
  async clearGracePeriod(userId: number, trx: TransactionClientContract): Promise<void> {
    // 1. check if user has an unresolved grace period
    const gracePeriod = await GracePeriod.query({ client: trx })
      .where('user_id', userId)
      .where('resolved', false)
      .forUpdate()
      .first()
    if (!gracePeriod) {
      logger.info('No active grace period to clear', { userId })
      return
    }

    gracePeriod.useTransaction(trx).merge({ resolved: true }).save()

    logger.info('Grace period cleared', {
      userId,
      gracePeriodId: gracePeriod.id,
      type: gracePeriod.type,
    })
  }

  /**
   * Get active grace period for a user
   *
   * @param userId - User to check
   * @returns Active grace period or null
   */
  async getActiveGracePeriod(userId: number): Promise<GracePeriod | null> {
    return await GracePeriod.query()
      .where('user_id', userId)
      .where('resolved', false)
      .where('expires_at', '>', DateTime.now().toSQL())
      .first()
  }

  /**
   * Degrade user to free tier after grace period expires
   * Performs cleanup: delete photos, lock gems, remove from share groups
   * This method updates the user's tier i.e tierService.updateUserTier() because it is not specifically called elsewhere.
   *
   * @param userId - User to degrade
   */
  async degradeUserToFree(userId: number, trx: TransactionClientContract): Promise<void> {
    const user = await User.query({ client: trx }).where('id', userId).forUpdate().firstOrFail()

    logger.info('Starting user degradation to free tier', {
      userId,
      currentTier: user.tier,
    })

    // 1. Delete non-primary photos (keep first photo per gem)
    const deletedPhotos = await this.deleteNonPrimaryPhotos(userId, trx)

    // 2. Lock gems over free tier limit (keep first 3)
    const lockedGems = await this.lockExcessGems(userId, trx)

    // 3. Remove user from share group(s)
    const removeFromAllShareGroups = await this.removeFromAllShareGroups(userId, trx)

    // 4. Resolve grace period
    const gracePeriod = await GracePeriod.query({ client: trx })
      .where('user_id', userId)
      .where('resolved', false)
      .forUpdate()
      .first()

    if (gracePeriod) {
      gracePeriod.resolved = true
      await gracePeriod.save()
    }

    // 5. Update user tier to free
    await this.tierService.updateUserTier(
      userId,
      'Grace period expired - degraded to free tier',
      'cron',
      trx,
      {
        gracePeriodId: gracePeriod?.id,
        gracePeriodType: gracePeriod?.type,
        deletedPhotos,
        lockedGems,
        removeFromAllShareGroups,
      }
    )

    logger.info('User degradation completed', {
      userId,
      deletedPhotos,
      lockedGems,
      removeFromAllShareGroups,
    })
  }

  /**
   * Check for expired grace periods and trigger degradation
   * This is called by a cron job (hourly)
   *
   * @returns Number of users degraded
   */
  async checkExpiredGracePeriods(trx: TransactionClientContract): Promise<number> {
    const expiredGracePeriods = await GracePeriod.query({ client: trx })
      .where('resolved', false)
      .where('expires_at', '<=', DateTime.now().toSQL())
      .forUpdate()
      .preload('user')

    logger.info('Checking expired grace periods', {
      count: expiredGracePeriods.length,
    })

    let degradedCount = 0

    for (const gracePeriod of expiredGracePeriods) {
      try {
        await this.degradeUserToFree(gracePeriod.userId, trx)
        degradedCount++
      } catch (error) {
        logger.error('Failed to degrade user after grace period expiry', {
          userId: gracePeriod.userId,
          gracePeriodId: gracePeriod.id,
          error: error.message,
        })
      }
    }

    logger.info('Expired grace periods processed', {
      total: expiredGracePeriods.length,
      degraded: degradedCount,
      failed: expiredGracePeriods.length - degradedCount,
    })

    return degradedCount
  }

  /**
   * Send warning emails to users in active grace periods
   * Called daily by cron job
   * Warns users their grace period is expiring soon
   *
   * @returns Number of warnings sent
   */
  async sendGracePeriodWarnings(): Promise<number> {
    const now = DateTime.now()
    const warningThreshold = now.plus({ hours: 24 })

    const gracePeriods = await GracePeriod.query()
      .where('resolved', false)
      .where('expires_at', '>', now.toSQL())
      .where('expires_at', '<=', warningThreshold.toSQL())
      .preload('user')

    let warningsSent = 0

    for (const gracePeriod of gracePeriods) {
      try {
        // TODO: Send actual email notification
        // await mail.send(new GracePeriodWarningMail(gracePeriod.user, gracePeriod))

        logger.info('Grace period warning sent (placeholder)', {
          userId: gracePeriod.userId,
          email: gracePeriod.user.email,
          type: gracePeriod.type,
          expiresAt: gracePeriod.expiresAt.toISO(),
          hoursRemaining: gracePeriod.expiresAt.diff(now, 'hours').hours,
        })

        warningsSent++
      } catch (error) {
        logger.error('Failed to send grace period warning', {
          userId: gracePeriod.userId,
          gracePeriodId: gracePeriod.id,
          error: error.message,
        })
      }
    }

    logger.info('Grace period warnings processed', {
      total: gracePeriods.length,
      sent: warningsSent,
      failed: gracePeriods.length - warningsSent,
    })

    return warningsSent
  }
}
