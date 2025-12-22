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

  async getSharedGemsForUser(userId: number, page: number = 1, perPage: number = 10) {
    const gems = await HiddenGem.query()
      .innerJoin('shared_gems', 'hidden_gems.id', 'shared_gems.hidden_gem_id')
      .innerJoin(
        'share_group_members',
        'shared_gems.share_group_id',
        'share_group_members.share_group_id'
      )
      .where('share_group_members.user_id', userId)
      .where('share_group_members.status', 'active')
      .preload('owner')
      .preload('photos', (query) => {
        query.orderBy('isPrimary', 'desc')
        query.orderBy('createdAt', 'asc')
      })
      .select('hidden_gems.*')
      .distinct()
      .paginate(page, perPage)

    return gems
  }

  async getSharedGemsInGroup(shareGroupId: number, page: number = 1, perPage: number = 10) {
    return await HiddenGem.query()
      .innerJoin('shared_gems', 'hidden_gems.id', 'shared_gems.hidden_gem_id')
      .where('shared_gems.share_group_id', shareGroupId)
      .preload('owner')
      .preload('photos')
      .select('hidden_gems.*')
      .distinct()
      .paginate(page, perPage)
  }

  async canUserAccessSharedGem(userId: number, hiddenGemId: number): Promise<boolean> {
    const sharedGem = await SharedGem.query().where('hidden_gem_id', hiddenGemId).first()

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

  async getSharedGroupsForGems(
    gemIds: number[]
  ): Promise<Record<number, Array<{ id: number; name: string }>>> {
    const sharedGems = await SharedGem.query()
      .whereIn('hidden_gem_id', gemIds)
      .preload('shareGroup', (query) => {
        query.select('id', 'name')
      })
      .select('hidden_gem_id', 'share_group_id')

    const result: Record<number, Array<{ id: number; name: string }>> = {}

    // Initialize all gem IDs with empty arrays
    gemIds.forEach((id) => {
      result[id] = []
    })

    // Populate with shared groups
    sharedGems.forEach((sharedGem) => {
      result[sharedGem.hiddenGemId].push({
        id: sharedGem.shareGroup.id,
        name: sharedGem.shareGroup.name,
      })
    })

    return result
  }

  async getSharedGemsInGroupMinimal(shareGroupId: number, page: number = 1, perPage: number = 10) {
    return await HiddenGem.query()
      .innerJoin('shared_gems', 'hidden_gems.id', 'shared_gems.hidden_gem_id')
      .where('shared_gems.share_group_id', shareGroupId)
      .select('hidden_gems.id', 'hidden_gems.name', 'hidden_gems.location')
      .distinct()
      .paginate(page, perPage)
  }
}
