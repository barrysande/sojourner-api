import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import ShareGroupService from '#services/share_group_service'
import NotificationService from '#services/notification_service'
import TierService from '#services/tier_service'
import {
  createShareGroupValidator,
  joinShareGroupValidator,
  inviteMembersValidator,
  acceptShareGroupInviteValidator,
} from '#validators/share_groups'
import logger from '@adonisjs/core/services/logger'
import ShareGroup from '#models/share_group'
import ChatService from '#services/chat_service'
import { disconnectUserFromGroup } from '#services/websocket_service'
import socket from '#services/socket'
import db from '@adonisjs/lucid/services/db'
import {
  InvalidInviteCodeException,
  AlreadyMemberException,
  GroupJoinDeniedException,
  InvalidInvitationException,
  GroupDissolvedException,
} from '#exceptions/share_group_exception'

@inject()
export default class ShareGroupsController {
  constructor(
    private shareGroupService: ShareGroupService,
    private notificationService: NotificationService,
    private tierService: TierService,
    private chatService: ChatService
  ) {}

  // GET AND SHOW USER'S SHARE GROUPS
  async index({ auth, request, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const page = request.input('page', 1)
      const perPage = request.input('perPage', 10)

      const shareGroups = await this.shareGroupService.getUserShareGroups(user.id, page, perPage)

      return response.ok(shareGroups)
    } catch (error) {
      return response.internalServerError({
        message: 'Failed to retrieve share groups',
      })
    }
  }

  //   CREATE NEW SHARE GROUP, CREATE CHAT ROOM & SEND NOTIFICATIONS
  async store({ auth, request, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const { name, inviteEmails: rawInviteEmails } =
        await request.validateUsing(createShareGroupValidator)

      const inviteEmails = rawInviteEmails ?? []

      // 1. check if user can create share groups 2. check if number of to-be members is within tier limits 3. generate invite code 4. create share group 5. create group membership 6. Create Chat room 7. process the invitations

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

      try {
        await this.chatService.createChatRoomForGroup(shareGroup.id)
      } catch (error) {
        logger.error('Failed to create chat room:', error)
      }

      let inviteResults
      if (inviteEmails.length > 0) {
        inviteResults = await this.shareGroupService.inviteMembersToGroup(
          shareGroup.id,
          user.id,
          inviteEmails
        )
      }

      return response.created({
        message: 'Share group created successfully',
        shareGroup,
        inviteResults,
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
        })
      }

      return response.internalServerError({
        message: 'Failed to create share group',
      })
    }
  }

  /**
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

      const shareGroup = await this.shareGroupService.getShareGroupWithDetails(shareGroupId)

      return response.ok({
        message: 'Share group details retrieved',
        shareGroup,
      })
    } catch (error) {
      return response.internalServerError({
        message: 'Failed to retrieve share group details',
      })
    }
  }

  /**
   * Join share group using invite code
   */
  async join({ request, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const { inviteCode } = await request.validateUsing(joinShareGroupValidator)

    try {
      const shareGroup = await db.transaction(async (trx) => {
        const group = await this.shareGroupService.getShareGroupByInviteCode(inviteCode, trx)

        if (!group) {
          throw new InvalidInviteCodeException()
        }

        const canJoin = await this.tierService.canJoinShareGroup(user, group, trx)
        if (!canJoin.canJoin) {
          throw new GroupJoinDeniedException(canJoin.message)
        }

        const existingMembership = await this.shareGroupService.findMembership(
          user.id,
          group.id,
          trx
        )

        if (existingMembership?.status === 'active') {
          throw new AlreadyMemberException()
        }

        if (existingMembership?.status === 'pending') {
          const accepted = await this.shareGroupService.acceptGroupInvitation(
            user.id,
            group.id,
            trx
          )
          if (!accepted) {
            throw new InvalidInvitationException()
          }
        } else if (existingMembership?.status === 'left') {
          const rejoined = await this.shareGroupService.rejoinGroup(user.id, group.id, trx)
          if (!rejoined) {
            throw new GroupDissolvedException()
          }
        } else {
          await this.shareGroupService.createGroupMembership(
            {
              shareGroupId: group.id,
              userId: user.id,
              invitedBy: group.createdBy,
              status: 'active',
              role: 'member',
              invitedAt: DateTime.now(),
              joinedAt: DateTime.now(),
            },
            trx
          )
        }

        return group
      })

      await this.notificationService.createGroupJoinedNotification(shareGroup.id, user.id)
      await this.chatService.createGroupJoinedSystemMessage(shareGroup.id, user.id)

      return response.ok({
        message: 'Successfully joined share group',
        shareGroup,
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({ message: 'Invalid invite code format' })
      }

      if (error instanceof InvalidInviteCodeException) {
        return response.badRequest({ message: error.message })
      }

      if (error instanceof AlreadyMemberException) {
        return response.conflict({ message: error.message })
      }

      if (error instanceof GroupJoinDeniedException) {
        return response.forbidden({ message: error.message })
      }

      if (error instanceof InvalidInvitationException) {
        return response.badRequest({ message: error.message })
      }

      if (error instanceof GroupDissolvedException) {
        return response.badRequest({ message: error.message })
      }

      logger.error('Failed to join share group:', error)
      return response.internalServerError({ message: 'Failed to join share group' })
    }
  }

  /**
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

      const inviteResults = await this.shareGroupService.inviteMembersToGroup(
        shareGroupId,
        user.id,
        emails
      )

      return response.ok({
        message: 'Invitations sent',
        inviteResults,
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
        })
      }

      logger.error('Invitation process failed:', error.messages)

      return response.internalServerError({
        message: 'Failed to send invitations',
      })
    }
  }

  /**
   * Leave share group
   */
  async leave({ auth, response, params }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const shareGroupId = params.id

      // 1. check membership status 2. remove member 3. notify other group members
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

      try {
        await this.chatService.createGroupLeftSystemMessage(shareGroupId, user.id)

        const deletedCount = await this.chatService.deleteUserMessagesFromGroup(
          user.id,
          shareGroupId
        )

        logger.info(`Deleted ${deletedCount} messages for user ${user.id}`)

        await disconnectUserFromGroup(socket.io, user.id, shareGroupId)
      } catch (error) {
        logger.error('Failed to handle leave chat cleanup:', error)
      }
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

      try {
        await this.chatService.createGroupDissolvedSystemMessage(shareGroupId, user.id)
      } catch (error) {
        logger.error('Failed to create dissolution message:', error)
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

  async minimalShareGroups({ auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const shareGroups = await this.shareGroupService.getUserShareGroupsMinimal(user.id)

      return response.ok({
        message: 'Minimal share groups retrieved successfully',
        shareGroups,
      })
    } catch (error) {
      return response.internalServerError({
        message: 'Failed to retrieve share groups',
      })
    }
  }

  async acceptShareGroupInvitation({ auth, request, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const { userId, shareGroupId } = await request.validateUsing(acceptShareGroupInviteValidator)

      await this.shareGroupService.acceptGroupInvitation(userId, shareGroupId)

      await this.notificationService.createGroupJoinedNotification(shareGroupId, user.id)

      await this.chatService.createGroupJoinedSystemMessage(shareGroupId, user.id)

      return response.ok({
        message: 'Successfully joined share group',
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
        })
      }
      return response.internalServerError({
        message: 'Failed to join group',
      })
    }
  }

  async removeMember({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const shareGroupId = params.id
    const targetUserId = params.memberId

    const canManage = await this.shareGroupService.canUserManageGroup(user.id, shareGroupId)

    if (!canManage) {
      return response.forbidden({
        message: 'Only group creators can remove members',
      })
    }

    if (Number(user.id) === Number(targetUserId)) {
      return response.badRequest({
        message: 'You cannot remove yourself. Please leave or dissolve the group.',
      })
    }

    await this.shareGroupService.removeShareGroupMember(targetUserId, shareGroupId)

    return response.ok({
      message: 'Member removed successfully',
    })
  }
}
