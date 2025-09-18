import HiddenGem from '#models/hidden_gem'
import SharedGem from '#models/shared_gem'
import ShareGroupMember from '#models/share_group_member'
import { DateTime } from 'luxon'

export default class SharingService {
  async shareGemsWithGroup(data: {
    gemIds: number[]
    shareGroupId: number
    sharedBy: number
    permissionLevel?: 'view' | 'edit' | 'admin'
  }): Promise<{ success: boolean; sharedGems?: SharedGem[]; message?: string }> {
    const sharedGemsData = data.gemIds.map((gemId) => ({
      hiddenGemId: gemId,
      userId: data.sharedBy,
      shareGroupId: data.shareGroupId,
      sharedBy: data.sharedBy,
      permissionLevel: data.permissionLevel || 'view',
      sharedAt: DateTime.now(),
      createdAt: DateTime.now(),
      updatedAt: DateTime.now(),
    }))

    try {
      const sharedGems = await SharedGem.createMany(sharedGemsData)
      return { success: true, sharedGems }
    } catch (error) {
      if (error.code === '23505') {
        return {
          success: false,
          message: 'One or more gems are already shared with this group',
        }
      }
      throw error
    }
  }

  async unshareGemsFromGroup(gemIds: number | number[], shareGroupId: number): Promise<number> {
    const gemIdArray = Array.isArray(gemIds) ? gemIds : [gemIds]

    const gemToUnshare = await SharedGem.query()
      .whereIn('hidden_gem_id', gemIdArray)
      .where('share_group_id', shareGroupId)
      .delete()

    return gemToUnshare.length
  }

  async getSharedGemsForUser(userId: number): Promise<HiddenGem[]> {
    return await HiddenGem.query()
      .innerJoin('shared_gems', 'hidden_gems.id', 'shared_gems.hidden_gem_id')
      .innerJoin(
        'share_group_members',
        'shared_gems.share_group_id',
        'share_group_members.share_group_id'
      )
      .where('share_group_members.user_id', userId)
      .where('share_group_members.status', 'active')
      .select('hidden_gems.*')
      .preload('owner')
      .preload('photos')
      .distinct()
  }
  async getSharedGemsInGroup(shareGroupId: number): Promise<HiddenGem[]> {
    return await HiddenGem.query()
      .innerJoin('shared_gems', 'hidden_gems.id', 'shared_gems.hidden_gem_id')
      .where('shared_gems.share_group_id', shareGroupId)
      .select('hidden_gems.*')
      .preload('owner')
      .preload('photos')
      .distinct()
  }

  async canUserAccessSharedGem(userId: number, sharedGemId: number): Promise<boolean> {
    const sharedGem = await SharedGem.query().where('id', sharedGemId).first()

    if (!sharedGem) {
      return false
    }

    const isMember = await ShareGroupMember.query()
      .where('user_id', userId)
      .where('share_group_id', sharedGem.shareGroupId)
      .where('status', 'active')
      .first()

    return !!isMember
  }

  async getUsersWithAccessToGem(gemId: number): Promise<number[]> {
    const userIds = await ShareGroupMember.query()
      .innerJoin('shared_gems', 'share_group_members.share_group_id', 'shared_gems.share_group_id')
      .where('shared_gems.hidden_gem_id', gemId)
      .where('share_group_members.status', 'active')
      .select('share_group_members.user_id')
      .distinct()

    return userIds.map((row) => row.userId)
  }
}
