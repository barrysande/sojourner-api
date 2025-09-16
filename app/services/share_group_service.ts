import ShareGroup from '#models/share_group'
import ShareGroupMember from '#models/share_group_member'
import SharedGem from '#models/shared_gem'
import { DateTime } from 'luxon'

export class ShareGroupService {
  generateUniqueInviteCode(): string {
    const timestamp = Date.now().toString(36).slice(-4)
    const random = Math.random().toString(36).slice(-4)
    return (timestamp + random).toUpperCase()
  }

  async isUserGroupMember(userId: number, shareGroupId: number): Promise<boolean> {
    const member = await ShareGroupMember.query()
      .where('user_id', userId)
      .where('share_group_id', shareGroupId)
      .where('status', 'active')
      .first()

    return !!member
  }

  async canUserManageGroup(userId: number, shareGroupId: number): Promise<boolean> {
    const member = await ShareGroupMember.query()
      .where('user_id', userId)
      .where('share_group_id', shareGroupId)
      .where('role', 'creator')
      .where('status', 'active')
      .first()

    return !!member
  }

  async createShareGroup(data: {
    name: string
    inviteCode: string
    createdBy: number
    maxMembers: number
    status?: 'active' | 'dissolved'
  }): Promise<ShareGroup> {
    return await ShareGroup.create({
      name: data.name,
      inviteCode: data.inviteCode,
      createdBy: data.createdBy,
      maxMembers: data.maxMembers,
      status: data.status || 'active',
    })
  }

  async getShareGroupByInviteCode(inviteCode: string): Promise<ShareGroup | null> {
    return await ShareGroup.query()
      .where('invite_code', inviteCode.toLocaleUpperCase())
      .where('status', 'active')
      .first()
  }

  async getUserShareGroups(userId: number): Promise<ShareGroup[]> {
    return await ShareGroup.query()
      .innerJoin('share_group_members', 'share_groups.id', 'share_group_members.share_group_id')
      .where('share_group_members.user_id', userId)
      .where('share_group_members.status', 'active')
      .where('share_groups.status', 'active')
      .select('share_groups.*')
      .distinct()
  }

  async createGroupMembership(data: {
    shareGroupId: number
    userId: number
    invitedBy: number
    status: 'pending' | 'active' | 'left'
    role: 'creator' | 'member'
    invitedAt: DateTime
    joinedAt?: DateTime | null
  }): Promise<ShareGroupMember> {
    return await ShareGroupMember.create({
      shareGroupId: data.shareGroupId,
      userId: data.userId,
      invitedBy: data.invitedBy,
      status: data.status,
      role: data.role,
      invitedAt: data.invitedAt,
      joinedAt: data.joinedAt || null,
    })
  }

  async acceptGroupInvitation(
    userId: number,
    shareGroupId: number
  ): Promise<ShareGroupMember | null> {
    const membership = await ShareGroupMember.query()
      .where('user_id', userId)
      .where('share_group_id', shareGroupId)
      .where('status', 'pending')
      .first()

    if (!membership) {
      return null
    }

    membership.status = 'active'
    membership.joinedAt = DateTime.now()
    await membership.save()

    return membership
  }

  async leaveShareGroup(userId: number, shareGroupId: number): Promise<ShareGroupMember | null> {
    const membership = await ShareGroupMember.query()
      .where('user_id', userId)
      .where('share_group_id', shareGroupId)
      .where('status', 'active')
      .first()

    if (!membership) {
      return null
    }

    membership.status = 'left'
    await membership.save()

    return membership
  }

  async dissolveShareGroup(shareGroupId: number): Promise<ShareGroup | null> {
    const shareGroup = await ShareGroup.find(shareGroupId)

    if (!shareGroup) {
      return null
    }

    shareGroup.status = 'dissolved'
    await shareGroup.save()

    return shareGroup
  }

  async getGroupMembers(shareGroupId: number): Promise<ShareGroupMember[]> {
    return await ShareGroupMember.query()
      .where('share_group_id', shareGroupId)
      .where('status', 'active')
      .preload('user', (query) => {
        query.select('id', 'email', 'full_name')
      })
  }

  async findMembership(userId: number, shareGroupId: number): Promise<ShareGroupMember | null> {
    return await ShareGroupMember.query()
      .where('user_id', userId)
      .where('share_group_id', shareGroupId)
      .first()
  }
}
