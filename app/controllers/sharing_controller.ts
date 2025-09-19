import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import SharingService from '#services/sharing_service'
import ShareGroupService from '#services/share_group_service'
import NotificationService from '#services/notification_service'
import TierService from '#services/tier_service'
import { shareGemsValidator, unshareGemsValidator } from '#validators/sharing'

@inject()
export default class SharingController {
  constructor(
    private sharingService: SharingService,
    private shareGroupService: ShareGroupService,
    private notificationService: NotificationService,
    private tierService: TierService
  ) {}

  /**
   * POST /api/share-groups/:id/gems
   * Share gems with a specific group
   */
  async store({ auth, params, request, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const shareGroupId = params.id
      const { gemIds, permissionLevel } = await request.validateUsing(shareGemsValidator)

      // 1. check if user sharing is a group member 2. check if user can share the gems 3. check the number of gems the user has shared 4. share the gems 5. create the share notification

      const isMember = await this.shareGroupService.isUserGroupMember(user.id, shareGroupId)
      if (!isMember) {
        return response.forbidden({ message: 'You are not a member of this share group' })
      }

      const canShare = await this.tierService.canCreateShareGroup(user.id)
      if (!canShare.canCreate) {
        return response.forbidden({
          message: canShare.message,
        })
      }

      const result = await this.sharingService.shareGemsWithGroup({
        gemIds,
        shareGroupId,
        sharedBy: user.id,
        permissionLevel,
      })
      if (!result.success) {
        return response.badRequest({
          message: result.message,
        })
      }

      const groupMembers = await this.shareGroupService.getGroupMembers(shareGroupId)
      const memberIds = groupMembers
        .filter((member) => member.userId !== user.id)
        .map((member) => member.userId)

      await this.notificationService.createGemSharedNotifications(
        memberIds,
        shareGroupId,
        user.id,
        gemIds
      )

      return response.created({
        message: `Successfully shared ${gemIds.length} gem(s) with the group`,
        sharedGems: result.sharedGems,
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
          errors: error.messages,
        })
      }

      return response.internalServerError({
        message: 'Failed to share gems',
      })
    }
  }

  /**
   * DELETE /api/share-groups/:id/gems
   * Unshare gems from a group
   */
  async destroy({ auth, params, request, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const shareGroupId = params.id
      const { gemIds } = await request.validateUsing(unshareGemsValidator)

      //1. check if user is a group member 2. ushare/delete shared gem
      const isMember = await this.shareGroupService.isUserGroupMember(user.id, shareGroupId)
      if (!isMember) {
        return response.forbidden({
          message: 'You are not a member of this share group',
        })
      }

      const deletedCount = await this.sharingService.unshareGemsFromGroup(gemIds, shareGroupId)
      if (deletedCount === 0) {
        return response.badRequest({
          message: 'No gems were found to unshare',
        })
      }

      return response.ok({
        message: `Successfully unshared ${deletedCount} gem(s) from the group`,
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
          errors: error.messages,
        })
      }

      return response.internalServerError({
        message: 'Failed to unshare gems',
      })
    }
  }

  /**
   * GET /api/shared-gems
   * Get all gems shared with the authenticated user
   */
  async index({ auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const sharedGems = await this.sharingService.getSharedGemsForUser(user.id)

      return response.ok({
        message: 'Shared gems retrieved successfully',
        sharedGems: sharedGems,
        count: sharedGems.length,
      })
    } catch (error) {
      return response.internalServerError({
        message: 'Failed to retrieve shared gems',
      })
    }
  }

  /**
   * GET /api/share-groups/:id/gems
   * Get gems shared in a specific group
   */
  async showGroupGems({ auth, params, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const shareGroupId = params.id

      // 1. check if authenticated user is a member of group 2. check if member, show groups

      const isMember = await this.shareGroupService.isUserGroupMember(user.id, shareGroupId)
      if (!isMember) {
        return response.forbidden({
          message: 'You are not a member of this share group',
        })
      }

      const groupSharedGems = await this.sharingService.getSharedGemsInGroup(shareGroupId)

      return response.ok({
        message: 'Group shared gems retrieved successfully',
        sharedGems: groupSharedGems,
        count: groupSharedGems.length,
      })
    } catch (error) {
      return response.internalServerError({
        message: 'Failed to retrieve group shared gems',
      })
    }
  }
}
