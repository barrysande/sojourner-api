import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import NotificationService from '#services/notification_service'
import { paginationValidator } from '#validators/notification'
import Notification from '#models/notification'

export default class NotificationsController {
  constructor(private notificationService: NotificationService) {}

  /**
   * GET /api/notifications
   * Get user's notifications with pagination
   */
  async index({ auth, response, request }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const { page = 1, limit = 20 } = await request.validateUsing(paginationValidator)
      const offset = (page - 1) * limit

      const notifications = await this.notificationService.getUserNotifications(
        user.id,
        limit,
        offset
      )
      const unreadCount = await this.notificationService.getUnreadNotificationCount(user.id)

      return response.ok({
        message: 'Notifications retrieved successfully',
        notifications,
        pagination: {
          page,
          limit,
          hasMore: notifications.length === limit,
        },
        unreadCount,
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Invalid pagination parameters',
          errors: error.messages,
        })
      }

      return response.internalServerError({
        message: 'Failed to retrieve notifications',
      })
    }
  }

  /**
   * GET /api/notifications/:id
   * Get specific notification
   */
  async show({ params, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const notificationId = params.id

      const notification = await Notification.query()
        .where('id', notificationId)
        .where('user_id', user.id)
        .firstOrFail()

      return response.ok({
        message: 'Notification retrieved successfully',
        notification,
      })
    } catch (error) {
      if (error.code === 'E_ROW_NOT_FOUND') {
        return response.notFound({
          message: 'Notification not found',
        })
      }

      return response.internalServerError({
        message: 'Failed to retrieve notification',
      })
    }
  }

  /**
   * PUT /api/notifications/:id/read
   * Mark specific notification as read
   */
  async update({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
  }
}
