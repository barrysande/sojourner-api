import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import NotificationService from '#services/notification_service'
import { paginationValidator, markNotificationsValidator } from '#validators/notification'
import Notification from '#models/notification'

@inject()
export default class NotificationsController {
  constructor(private notificationService: NotificationService) {}

  /**
   * GET /api/notifications
   * Get user's notifications with pagination
   */
  async index({ auth, response, request }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const { page = 1, perPage = 20 } = await request.validateUsing(paginationValidator)

      const notifications = await this.notificationService.getUserNotifications(
        user.id,
        page,
        perPage
      )
      const unreadCount = await this.notificationService.getUnreadNotificationCount(user.id)

      return response.ok({
        message: 'Notifications retrieved successfully',
        ...notifications.serialize(),
        unreadCount,
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Invalid pagination parameters',
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
   * PUT /api/notifications/read
   * Mark specific notification as read
   */
  async update({ request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const { notificationIds } = await request.validateUsing(markNotificationsValidator)

      // Verify ownership
      const notifications = await Notification.query()
        .whereIn('id', notificationIds)
        .where('user_id', user.id)

      if (notifications.length !== notificationIds.length) {
        return response.forbidden({
          message: 'Some notifications do not belong to you',
        })
      }

      await this.notificationService.markNotificationsAsRead(notificationIds)

      return response.ok({
        message: 'Marked notification(s) as read',
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Invalid notification IDs',
        })
      }

      return response.internalServerError({
        message: 'Failed to mark notifications as read',
      })
    }
  }

  /**
   * PUT /api/notifications/read-all
   * Mark all notifications as read
   */
  async markAllRead({ response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      await this.notificationService.markAllNotificationsAsRead(user.id)

      return response.ok({
        message: 'Marked notifications as read',
      })
    } catch (error) {
      return response.internalServerError({
        message: 'Failed to mark all notifications as read',
      })
    }
  }

  /**
   * DELETE /api/notifications/:id
   * Delete specific notification
   */
  async destroy({ params, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const notificationId = params.id

      //   1.check notification ownership 2. delete notification
      await Notification.query().where('id', notificationId).where('user_id', user.id).firstOrFail()

      const deleted = await this.notificationService.deleteNotification(notificationId)

      if (!deleted) {
        return response.badRequest({
          message: 'Failed to delete notification',
        })
      }

      return response.ok({
        message: 'Notification deleted successfully',
      })
    } catch (error) {
      if (error.code === 'E_ROW_NOT_FOUND') {
        return response.notFound({
          message: 'Notification not found',
        })
      }

      return response.internalServerError({
        message: 'Failed to delete notification',
      })
    }
  }

  /**
   * GET /api/notifications/unread-count
   * Get count of unread notifications
   */
  async unreadCount({ response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      //   no need for notification ownership because the notification service method getUnreadNotificationCount does it
      const count = await this.notificationService.getUnreadNotificationCount(user.id)

      return response.ok({
        unreadCount: count,
      })
    } catch (error) {
      return response.internalServerError({
        message: 'Failed to get unread notification count',
      })
    }
  }
}
