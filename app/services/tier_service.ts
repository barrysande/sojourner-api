import User from '#models/user'
import Photo from '#models/photo'
import HiddenGem from '#models/hidden_gem'

export default class TierService {
  getTierLimits(tier: string) {
    const limits = {
      free: {
        maxPhotosPerGem: 3,
        maxGemsTotal: 10,
        canShare: false,
        maxFileSize: 5 * 1024 * 1024, // 5MB
      },
      individual_paid: {
        maxPhotosPerGem: 50,
        maxGemsTotal: 1000,
        canShare: true,
        maxFileSize: 20 * 1024 * 1024, // 20MB
      },
      group_paid: {
        maxPhotosPerGem: 100,
        maxGemsTotal: 5000,
        canShare: true,
        maxFileSize: 50 * 1024 * 1024, // 50MB
      },
    }
    return limits[tier as keyof typeof limits] || limits.free
  }

  //   Check if user can add photos bases on tier limits set in limits object.

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

  //   Check if user can add photos bases on tier limits set in limits object.
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
}
