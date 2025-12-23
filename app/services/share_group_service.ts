import ShareGroup from '#models/share_group'
import ShareGroupMember from '#models/share_group_member'
import User from '#models/user'
import Notification from '#models/notification'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'

interface InviteResult {
  email: string
  status: 'sent' | 'failed'
  reason?: string
}

export default class ShareGroupService {
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
      .where('invite_code', inviteCode.toUpperCase())
      .where('status', 'active')
      .first()
  }

  async getShareGroupWithDetails(shareGroupId: number): Promise<ShareGroup> {
    return await ShareGroup.query()
      .where('id', shareGroupId)
      .preload('members', (query) => {
        query.where('status', 'active').preload('user', (userQuery) => {
          userQuery.select('id', 'email', 'fullName')
        })
      })
      .firstOrFail()
  }

  async getUserShareGroups(userId: number, page: number = 1, perPage: number = 10) {
    return await ShareGroup.query()
      .innerJoin('share_group_members', 'share_groups.id', 'share_group_members.share_group_id')
      .where('share_group_members.user_id', userId)
      .where('share_group_members.status', 'active')
      .where('share_groups.status', 'active')
      .preload('members', (query) => {
        query.where('status', 'active')
      })
      .select('share_groups.*')
      .distinct()
      .paginate(page, perPage)
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

  async inviteMembersToGroup(
    shareGroupId: number,
    inviterId: number,
    emails: string[]
  ): Promise<InviteResult[]> {
    const results: InviteResult[] = []

    // Normalize emails
    const normalizedEmails = emails.map((email) => email.toLowerCase().trim())

    // Fetch users in one query
    const users = await User.query().whereIn('email', normalizedEmails)

    const usersByEmail = new Map(users.map((user) => [user.email, user]))

    // Fetch existing memberships in one query
    const userIds = users.map((user) => user.id)
    const existingMemberships = await ShareGroupMember.query()
      .where('share_group_id', shareGroupId)
      .whereIn('user_id', userIds)

    const membershipsByUserId = new Map(
      existingMemberships.map((membership) => [membership.userId, membership])
    )

    const tierService = await app.container.make('tierService')

    for (const email of normalizedEmails) {
      const user = usersByEmail.get(email)

      if (!user) {
        results.push({ email, status: 'failed', reason: 'User not found' })
        continue
      }

      const tierLimits = tierService.getTierLimits(user.tier)
      if (!tierLimits.canShare) {
        results.push({
          email,
          status: 'failed',
          reason: 'Upgrade to paid Individual Plan',
        })
        continue
      }

      const existingMembership = membershipsByUserId.get(user.id)

      // Active member → block
      if (existingMembership?.status === 'active') {
        results.push({ email, status: 'failed', reason: 'Already a member' })
        continue
      }

      // Pending invite → block
      if (existingMembership?.status === 'pending') {
        results.push({ email, status: 'failed', reason: 'Already invited' })
        continue
      }

      // Re-invite after leaving OR first invite
      await ShareGroupMember.updateOrCreate(
        {
          userId: user.id,
          shareGroupId,
        },
        {
          status: 'pending',
          invitedBy: inviterId,
          role: 'member',
          invitedAt: DateTime.now(),
        }
      )

      await Notification.create({
        userId: user.id,
        type: 'share_group_invite',
        title: 'Share Group Invitation',
        message: `You've been invited to join a share group`,
        data: { shareGroupId, inviterId },
        isRead: false,
        sentAt: DateTime.now(),
      })

      results.push({ email, status: 'sent' })
    }

    return results
  }

  async acceptGroupInvitation(
    userId: number,
    shareGroupId: number
  ): Promise<ShareGroupMember | null> {
    const membership = await ShareGroupMember.query()
      .where('user_id', userId)
      .where('share_group_id', shareGroupId)
      .whereIn('status', ['pending', 'left'])
      .first()

    if (!membership) {
      return null
    }

    await membership.merge({ status: 'active', joinedAt: DateTime.now() }).save()

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

    await membership.merge({ status: 'left' }).save()

    return membership
  }

  async dissolveShareGroup(shareGroupId: number): Promise<ShareGroup | null> {
    const shareGroup = await ShareGroup.find(shareGroupId)

    if (!shareGroup) {
      return null
    }

    await shareGroup.merge({ status: 'dissolved' }).save()

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

  async getUserShareGroupsMinimal(userId: number) {
    return await ShareGroup.query()
      .innerJoin('share_group_members', 'share_groups.id', 'share_group_members.share_group_id')
      .where('share_group_members.user_id', userId)
      .where('share_group_members.status', 'active')
      .where('share_groups.status', 'active')
      .select('share_groups.id', 'share_groups.name')
      .distinct()
  }
}
