import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import SharingService from '#services/sharing_service'
import ShareGroupService from '#services/share_group_service'
import NotificationService from '#services/notification_service'
import { shareGemsValidator, unshareGemsValidator } from '#validators/sharing'
import HiddenGem from '#models/hidden_gem'
import SharedGem from '#models/shared_gem'
import ChatService from '#services/chat_service'
import logger from '@adonisjs/core/services/logger'
import TierService from '#services/tier_service'
import ImageProcessingService from '#services/image_processing_service'
import { sharedStatusValidator } from '#validators/sharing'

@inject()
export default class SharingController {
  constructor(
    protected sharingService: SharingService,
    protected shareGroupService: ShareGroupService,
    protected notificationService: NotificationService,
    protected chatService: ChatService,
    protected tierService: TierService,
    protected imageProcessingService: ImageProcessingService
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

      // 1. check if user sharing is a group member 2. check if user can share the gems based on tier limits 3. check is the user owns the gems being shared 4. share the gems 5. create the share notification

      const isMember = await this.shareGroupService.isUserGroupMember(user.id, shareGroupId)
      if (!isMember) {
        return response.forbidden({ message: 'You are not a member of this share group' })
      }

      const canShare = await this.tierService.canShareGemsToGroup(
        user.id,
        shareGroupId,
        gemIds.length
      )
      if (!canShare.canShare) {
        return response.forbidden({
          message: canShare.message,
        })
      }

      const userGems = await HiddenGem.query().whereIn('id', gemIds).where('user_id', user.id)
      if (userGems.length !== gemIds.length) {
        return response.forbidden({
          message: 'You can only share gems that you own',
        })
      }

      const groupMembers = await this.shareGroupService.getGroupMembers(shareGroupId)
      const memberIds = groupMembers
        .filter((member) => member.userId !== user.id)
        .map((member) => member.userId)

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

      await this.notificationService.createGemSharedNotifications(
        memberIds,
        shareGroupId,
        user.id,
        gemIds
      )

      try {
        await this.chatService.createGemSharedSystemMessage(shareGroupId, user.id, gemIds)
      } catch (error) {
        logger.error('Failed to create gem shared system message:', error)
      }

      return response.created({
        message: `Successfully shared ${gemIds.length} gem(s) with the group`,
        // sharedGems: result.sharedGems,
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
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

      //1. check if user is a group member 2. check is the user shared the gems they are trying to delete 3. unshare/delete shared gem
      const isMember = await this.shareGroupService.isUserGroupMember(user.id, shareGroupId)
      if (!isMember) {
        return response.forbidden({
          message: 'You are not a member of this share group',
        })
      }

      const userSharedGems = await SharedGem.query()
        .whereIn('hidden_gem_id', gemIds)
        .where('share_group_id', shareGroupId)
        .where('shared_by', user.id)
      if (userSharedGems.length !== gemIds.length) {
        return response.forbidden({
          message: 'You can only unshare gems that you shared',
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
  async index({ auth, response, request }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const page = request.input('page', 1)
      const perPage = request.input('perPage', 10)

      const sharedGems = await this.sharingService.getSharedGemsForUser(user.id, page, perPage)

      const serialized = sharedGems.serialize()
      const gemsWithUrls = await Promise.all(
        serialized.data.map(async (gem) => ({
          ...gem,
          photos: await this.imageProcessingService.getPhotoUrls(
            sharedGems.all().find((g) => g.id === gem.id)?.photos || []
          ),
        }))
      )

      return response.ok({
        message: 'Shared gems retrieved successfully',
        sharedGems: gemsWithUrls,
        meta: serialized.meta,
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
  async showGroupGems({ auth, params, response, request }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const shareGroupId = params.id

      // 1. check if authenticated user is a member of group 2. check if member, show groups

      const page = request.input('page', 1)

      const perPage = request.input('perPage', 10)

      const isMember = await this.shareGroupService.isUserGroupMember(user.id, shareGroupId)
      if (!isMember) {
        return response.forbidden({
          message: 'You are not a member of this share group',
        })
      }

      const groupSharedGems = await this.sharingService.getSharedGemsInGroup(
        shareGroupId,
        page,
        perPage
      )

      return response.ok({
        message: 'Group shared gems retrieved successfully',
        sharedGems: groupSharedGems.all(),
        meta: groupSharedGems.getMeta(),
        count: groupSharedGems.length,
      })
    } catch (error) {
      return response.internalServerError({
        message: 'Failed to retrieve group shared gems',
      })
    }
  }

  async showSharedGem({ auth, params, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const gemId = params.id

      const hasAccess = await this.sharingService.canUserAccessSharedGem(user.id, gemId)
      if (!hasAccess) {
        return response.forbidden({
          message: 'You do not have access to this shared gem',
        })
      }

      const gem = await HiddenGem.query()
        .where('id', gemId)
        .preload('photos', (query) => {
          query.orderBy('isPrimary', 'desc')
          query.orderBy('createdAt', 'asc')
        })
        .preload('owner')
        .preload('expenses')
        .preload('postVisitNotes')
        .firstOrFail()

      const photosWithUrls = await this.imageProcessingService.getPhotoUrls(gem.photos)

      return response.ok({
        gem,
        photos: photosWithUrls,
      })
    } catch (error) {
      if (error.code === 'E_ROW_NOT_FOUND') {
        return response.notFound({
          message: 'Shared gem not found',
        })
      }
      return response.internalServerError({
        message: 'Failed to retrieve shared gem',
      })
    }
  }

  /**
   * Get share groups for multiple gems
   */
  async sharedStatus({ auth, request, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const { gemIds } = await request.validateUsing(sharedStatusValidator)

      // Verify user owns these gems
      const userGems = await HiddenGem.query()
        .whereIn('id', gemIds)
        .where('user_id', user.id)
        .select('id')

      const ownedGemIds = userGems.map((g) => g.id)

      const sharedStatus = await this.sharingService.getSharedGroupsForGems(ownedGemIds)

      return response.ok({
        sharedStatus,
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
          errors: error.messages,
        })
      }

      return response.internalServerError({
        message: 'Failed to retrieve shared status',
      })
    }
  }

  async showGroupGemsMinimal({ auth, params, response, request }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const shareGroupId = params.id
      const page = request.input('page', 1)
      const perPage = request.input('perPage', 10)

      const isMember = await this.shareGroupService.isUserGroupMember(user.id, shareGroupId)
      if (!isMember) {
        return response.forbidden({
          message: 'You are not a member of this share group',
        })
      }

      const groupSharedGems = await this.sharingService.getSharedGemsInGroupMinimal(
        shareGroupId,
        page,
        perPage
      )

      return response.ok({
        message: 'Group shared gems retrieved successfully',
        sharedGems: groupSharedGems.all(),
        meta: groupSharedGems.getMeta(),
      })
    } catch (error) {
      return response.internalServerError({
        message: 'Failed to retrieve group shared gems',
      })
    }
  }
}
