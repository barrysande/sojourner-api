import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import User from '#models/user'
import Notification from '#models/notification'
import ShareGroupService from '#services/share_group_service'
import NotificationService from '#services/notification_service'
import TierService from '#services/tier_service'
import {
  createShareGroupValidator,
  joinShareGroupValidator,
  inviteMembersValidator,
} from '#validators/share_groups'
import ShareGroupMember from '#models/share_group_member'
import logger from '@adonisjs/core/services/logger'
import ShareGroup from '#models/share_group'

@inject()
export default class ShareGroupsController {
  constructor(
    private shareGroupService: ShareGroupService,
    private notificationService: NotificationService,
    private tierService: TierService
  ) {}

  private async processInvitations(
    shareGroupId: number,
    inviterId: number,
    emails: string[]
  ): Promise<{ sent: string[]; failed: string[] }> {
    const sent: string[] = []
    const failed: string[] = []

    // 1. Batch fetch all users by email (single query)
    const normalizedEmails = emails.map((email) => email.toLowerCase().trim())
    const users = await User.query().whereIn('email', normalizedEmails)

    // 2. Batch fetch existing memberships (single query)
    const userIds = users.map((user) => user.id)
    const existingMemberships = await ShareGroupMember.query()
      .where('share_group_id', shareGroupId)
      .whereIn('user_id', userIds)

    // 3. Create lookup maps
    const usersByEmail = new Map(users.map((user) => [user.email, user]))
    const membershipsByUserId = new Map(
      existingMemberships.map((membership) => [membership.userId, membership])
    )

    // 4. Process each email using cached data
    const validInvitations = []

    for (const email of emails) {
      const normalizedEmail = email.toLowerCase().trim()
      const user = usersByEmail.get(normalizedEmail)

      if (!user) {
        failed.push(`${email}: User not found`)
        continue
      }

      // Check tier permissions
      const tierLimits = this.tierService.getTierLimits(user.tier)
      if (!tierLimits.canShare) {
        failed.push(`${email}: Upgrade to paid Individual Plan`)
        continue
      }

      const existingMembership = membershipsByUserId.get(user.id)
      if (existingMembership) {
        if (existingMembership.status === 'active') {
          failed.push(`${email}: Already a member`)
          continue
        }
        if (existingMembership.status === 'pending') {
          failed.push(`${email}: Already invited`)
          continue
        }
      }

      // Valid invitation
      validInvitations.push({
        userId: user.id,
        shareGroupId,
        invitedBy: inviterId,
        status: 'pending' as const,
        role: 'member' as const,
        invitedAt: DateTime.now(),
      })
      sent.push(email)
    }

    // 5. Batch create memberships
    if (validInvitations.length > 0) {
      await ShareGroupMember.createMany(validInvitations)

      // 6. Batch create notifications
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

    return { sent, failed }
  }

  //    GET /api/share-groups
  //    GET USER'S SHARE GROUPS
  async index({ auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const shareGroups = await this.shareGroupService.getUserShareGroups(user.id)

      return response.ok({
        message: 'Share groups retrieved successfully',
        shareGroups: shareGroups,
      })
    } catch (error) {
      return response.internalServerError({
        message: 'Failed to retrieve share groups',
      })
    }
  }

  //   POST /api/share-groups
  //   CREATE NEW SHARE GROUPS & SEND NOTIFICATIONS
  async store({ auth, request, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const { name, inviteEmails } = await request.validateUsing(createShareGroupValidator)

      const canCreate = await this.tierService.canCreateShareGroup(user.id)

      if (!canCreate.canCreate) {
        return response.forbidden({
          message: canCreate.message,
        })
      }

      const maxMembersResult = await this.tierService.getMaxMembersPerGroup(user.id)

      if (inviteEmails.length + 1 > maxMembersResult.maxMembers) {
        return response.badRequest({
          message: `Cannot invite ${inviteEmails.length} users. Maximum ${maxMembersResult.maxMembers - 1} invitations allowed.`,
        })
      }

      const inviteCode = this.shareGroupService.generateUniqueInviteCode()

      const shareGroup = await this.shareGroupService.createShareGroup({
        name,
        inviteCode,
        createdBy: user.id,
        maxMembers: maxMembersResult.maxMembers,
        status: 'active',
      })

      await this.shareGroupService.createGroupMembership({
        shareGroupId: shareGroup.id,
        userId: user.id,
        invitedBy: user.id,
        status: 'active',
        role: 'creator',
        invitedAt: DateTime.now(),
        joinedAt: DateTime.now(),
      })

      const inviteResults = await this.processInvitations(shareGroup.id, user.id, inviteEmails)

      return response.created({
        message: 'Share group created successfully',
        shareGroup: shareGroup,
        inviteResults: inviteResults,
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
          errors: error.messages,
        })
      }

      return response.internalServerError({
        message: 'Failed to create share group',
      })
    }
  }

  /**
   * GET /api/share-groups/:id
   * Get specific share group details
   */
  async show({ auth, params, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const shareGroupId = params.id
      const isMember = await this.shareGroupService.isUserGroupMember(user.id, shareGroupId)

      if (!isMember) {
        return response.notFound({
          message: 'You cannot view this share group.',
        })
      }

      const members = await this.shareGroupService.getGroupMembers(shareGroupId)

      return response.ok({
        message: 'Share group details retrieved',
        members: members,
      })
    } catch (error) {
      return response.internalServerError({
        message: 'Failed to retrieve share group details',
      })
    }
  }

  /**
   * POST /api/share-groups/join
   * Join share group using invite code
   */
  async join({ request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const { inviteCode } = await request.validateUsing(joinShareGroupValidator)

      // Check tier permissions
      const canJoin = await this.tierService.canJoinShareGroup(user.id)
      if (!canJoin.canJoin) {
        return response.forbidden({
          message: canJoin.message,
        })
      }

      // Find share group by invite code
      const shareGroup = await this.shareGroupService.getShareGroupByInviteCode(inviteCode)
      if (!shareGroup) {
        return response.badRequest({
          message: 'Invalid invite code',
        })
      }

      // Check group capacity
      const currentMembers = await this.shareGroupService.getGroupMembers(shareGroup.id)
      if (currentMembers.length >= shareGroup.maxMembers) {
        return response.badRequest({ message: 'Share group is full' })
      }

      // Check if user has an active membership - refuse if active, accept by calling acceptGroupInvitation which add the user to group
      const existingMembership = await this.shareGroupService.findMembership(user.id, shareGroup.id)

      if (existingMembership) {
        if (existingMembership.status === 'active') {
          return response.conflict({
            message: 'You are already a member of this group',
          })
        } else if (existingMembership.status === 'pending') {
          await this.shareGroupService.acceptGroupInvitation(user.id, shareGroup.id)

          await this.notificationService.createGroupJoinedNotification(shareGroup.id, user.id)

          return response.ok({
            message: 'Successfully joined share group',
            shareGroup: shareGroup,
          })
        }
      }

      await this.shareGroupService.createGroupMembership({
        shareGroupId: shareGroup.id,
        userId: user.id,
        invitedBy: shareGroup.createdBy,
        status: 'active',
        role: 'member',
        invitedAt: DateTime.now(),
        joinedAt: DateTime.now(),
      })

      await this.notificationService.createGroupJoinedNotification(shareGroup.id, user.id)
      return response.ok({
        message: 'Successfully joined share group',
        shareGroup: shareGroup,
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Invalid invite code format',
          errors: error.messages,
        })
      }

      return response.internalServerError({
        message: 'Failed to join share group',
      })
    }
  }

  /**
   * POST /api/share-groups/:id/invite
   * Invite additional members to existing group
   */
  async invite({ params, request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const shareGroupId = params.id
      const { emails } = await request.validateUsing(inviteMembersValidator)
      // 1. can user manage group? 2.  process invitations. 3. Check Group Capacity Check 4. Create Notification.

      const canUserManageGroup = await this.shareGroupService.canUserManageGroup(
        user.id,
        shareGroupId
      )
      if (!canUserManageGroup) {
        return response.forbidden({
          message: 'Only group creators can invite members',
        })
      }

      const shareGroup = await ShareGroup.findOrFail(shareGroupId)
      const currentMembers = await this.shareGroupService.getGroupMembers(shareGroupId)

      if (currentMembers.length + emails.length > shareGroup.maxMembers) {
        return response.badRequest({
          message: `Cannot invite ${emails.length} users. Group would exceed capacity.`,
        })
      }

      const inviteResults = await this.processInvitations(shareGroupId, user.id, emails)

      return response.ok({
        message: 'Invitations sent',
        inviteResults: inviteResults,
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
          errors: error.messages,
        })
      }

      logger.error('Invitation process failed:', error)

      return response.internalServerError({
        message: 'Failed to send invitations',
      })
    }
  }

  /**
   * DELETE /api/share-groups/:id/leave
   * Leave share group
   */
  async leave({ auth, response, params }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const shareGroupId = params.id

      const isMember = await this.shareGroupService.isUserGroupMember(user.id, shareGroupId)
      if (!isMember) {
        return response.notFound({
          message: 'You are not a member of this group',
        })
      }

      const leftMembership = await this.shareGroupService.leaveShareGroup(user.id, shareGroupId)
      if (!leftMembership) {
        return response.badRequest({
          message: 'Failed to leave group',
        })
      }

      await this.notificationService.createGroupLeftNotification(shareGroupId, user.id)
      return response.ok({
        message: 'Successfully left share group',
      })
    } catch (error) {
      return response.internalServerError({
        message: 'Failed to leave share group',
      })
    }
  }

  /**
   * DELETE /api/share-groups/:id
   * Dissolve share group (creator only)
   */
  async destroy({ auth, params, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const shareGroupId = params.id

      const canManage = await this.shareGroupService.canUserManageGroup(user.id, shareGroupId)
      if (!canManage) {
        return response.forbidden({
          message: 'Only group creators can dissolve groups',
        })
      }

      const dissolvedGroup = await this.shareGroupService.dissolveShareGroup(shareGroupId)
      if (!dissolvedGroup) {
        return response.notFound({
          message: 'Share group not found',
        })
      }

      await this.notificationService.createGroupDissolvedNotification(shareGroupId, user.id)
      return response.ok({
        message: 'Share group dissolved successfully',
      })
    } catch (error) {
      return response.internalServerError({
        message: 'Failed to dissolve share group',
      })
    }
  }
}
