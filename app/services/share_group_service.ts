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

  async getUserShareGroups(userId: number): Promise<ShareGroup[]> {
    return await ShareGroup.query()
      .innerJoin('share_group_members', 'share_groups.id', 'share_group_members.share_group_id')
      .where('share_group_members.user_id', userId)
      .where('share_group_members.status', 'active')
      .where('share_groups.status', 'active')
      .select('share_groups.*')
      .preload('members', (query) => {
        query.where('status', 'active').preload('user', (userQuery) => {
          userQuery.select('id', 'email', 'fullName')
        })
      })
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

  async inviteMembersToGroup(
    shareGroupId: number,
    inviterId: number,
    emails: string[]
  ): Promise<InviteResult[]> {
    const results: InviteResult[] = []

    // 1. Batch fetch all users by email (single query) 2. Batch fetch existing memberships (single query) 3. Create lookup maps 4. Process each email using cached data 5. Check tier permissions- tier limits and membership status 6. Construct invitation. 7. Batch create them 8. Batch create memberships 9. Batch create notifications 10. send invitation code via email.
    const normalizedEmails = emails.map((email) => email.toLowerCase().trim())
    const users = await User.query().whereIn('email', normalizedEmails)

    const userIds = users.map((user) => user.id)
    const existingMemberships = await ShareGroupMember.query()
      .where('share_group_id', shareGroupId)
      .whereIn('user_id', userIds)

    const usersByEmail = new Map(users.map((user) => [user.email, user]))
    const membershipsByUserId = new Map(
      existingMemberships.map((membership) => [membership.userId, membership])
    )

    const validInvitations = []

    for (const email of emails) {
      const normalizedEmail = email.toLowerCase().trim()
      const user = usersByEmail.get(normalizedEmail)

      if (!user) {
        results.push({ email, status: 'failed', reason: 'User not found' })
        continue
      }

      const tierService = await app.container.make('tierService')

      const tierLimits = tierService.getTierLimits(user.tier)
      if (!tierLimits.canShare) {
        results.push({ email, status: 'failed', reason: 'Upgrade to paid Individual Plan' })
        continue
      }
      const existingMembership = membershipsByUserId.get(user.id)
      if (existingMembership) {
        if (existingMembership.status === 'active') {
          results.push({ email, status: 'failed', reason: 'Already a member' })
          continue
        }
        if (existingMembership.status === 'pending') {
          results.push({ email, status: 'failed', reason: 'Already invited' })
          continue
        }
      }

      validInvitations.push({
        userId: user.id,
        shareGroupId,
        invitedBy: inviterId,
        status: 'pending' as const,
        role: 'member' as const,
        invitedAt: DateTime.now(),
      })
      results.push({ email, status: 'sent' })
    }
    if (validInvitations.length > 0) {
      await ShareGroupMember.createMany(validInvitations)

      const notificationData = validInvitations.map((invitation) => ({
        userId: invitation.userId,
        type: 'share_group_invite' as const,
        title: 'Share Group Invitation',
        message: `You've been invited to join a share group`,
        data: { shareGroupId, inviterId },
        isRead: false,
        sentAt: DateTime.now(),
      }))

      await Notification.createMany(notificationData)
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
