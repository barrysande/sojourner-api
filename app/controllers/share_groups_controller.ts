import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import User from '#models/user'
import ShareGroupService from '#services/share_group_service'
import NotificationService from '#services/notification_service'
import TierService from '#services/tier_service'
import {
  createShareGroupValidator,
  joinShareGroupValidator,
  inviteMembersValidator,
} from '#validators/share_groups'

@inject()
export default class ShareGroupsController {
  constructor(
    private shareGroupService: ShareGroupService,
    private notificationService: NotificationService,
    private tierService: TierService
  ) {}

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
      const { name, inviteEmail } = await request.validateUsing(createShareGroupValidator)

      const canCreate = await this.t
    } catch (error) {}
  }
}
