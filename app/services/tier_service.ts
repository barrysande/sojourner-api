import User from '#models/user'
import Photo from '#models/photo'
import HiddenGem from '#models/hidden_gem'

export default class TierService {
  getTierLimits(tier: string) {
    const limits = {
      free: {
        maxPhotosPerGem: 3,
        maxGemsTotal: 3,
        canShare: false,
        maxShareGroups: 0,
        maxMembersPerGroup: 0,
        maxFileSize: 5 * 1024 * 1024, // 5MB
      },
      individual_paid: {
        maxPhotosPerGem: 6,
        maxGemsTotal: 1000,
        canShare: true,
        maxShareGroups: 10,
        maxMembersPerGroup: 10,
        maxFileSize: 5 * 1024 * 1024, // 5MB
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

  //   Check if user can add photos based on tier limits set in limits object.
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
}
