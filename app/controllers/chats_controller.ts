import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import ChatService from '#services/chat_service'
import ChatMessage from '#models/chat_message'
import { messageHistoryValidator, deleteMessageValidator } from '#validators/chat'

@inject()
export default class ChatsController {
  constructor(protected chatService: ChatService) {}

  async getGroupChatRoom({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const shareGroupId = Number(params.shareGroupId)

    if (Number.isNaN(shareGroupId)) {
      return response.badRequest({ message: 'Invalid share group ID' })
    }

    const hasAccess = await this.chatService.validateChatAccess(user.id, shareGroupId)

    if (!hasAccess) {
      return response.forbidden({ message: 'Access denied to this chat room' })
    }

    const chatRoom = await this.chatService.createOrFindChatRoom(shareGroupId)

    return response.ok({ chatRoom: chatRoom.toJSON() })
  }

  async getMessages({ auth, params, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const roomId = Number(params.roomId)

    if (Number.isNaN(roomId)) {
      return response.badRequest({ message: 'Invalid room ID' })
    }

    const { page, limit } = await messageHistoryValidator.validate(request.qs())

    const chatRoom = await this.chatService.getChatRoomById(roomId)
    if (!chatRoom) {
      return response.notFound({ message: 'Chat room not found' })
    }

    const hasAccess = await this.chatService.validateChatAccess(user.id, chatRoom.shareGroupId)

    if (!hasAccess) {
      return response.forbidden({ message: 'Access denied to this chat room' })
    }

    const history = await this.chatService.getChatHistory(roomId, page, limit)

    return response.ok({ history })
  }

  async getUserRooms({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const chatRooms = await this.chatService.getUserChatRooms(user.id)

    return response.ok({ chatRooms })
  }

  async deleteMessage({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const { messageId } = await deleteMessageValidator.validate(params)

    const message = await ChatMessage.query()
      .where('id', messageId)
      .where('user_id', user.id)
      .first()

    if (!message) {
      return response.notFound({ message: 'Message not found or not authorized' })
    }

    await message.delete()
    return response.ok({ message: 'Message deleted successfully' })
  }

  async deleteAllMyMessages({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const shareGroupId = Number(params.shareGroupId)

    if (Number.isNaN(shareGroupId)) {
      return response.badRequest({ message: 'Invalid share group ID' })
    }

    const hasAccess = await this.chatService.validateChatAccess(user.id, shareGroupId)
    if (!hasAccess) {
      return response.forbidden({ message: 'Access denied' })
    }

    const deletedCount = await this.chatService.deleteUserMessagesFromGroup(user.id, shareGroupId)

    return response.ok({
      message: 'All your messages deleted',
      count: deletedCount,
    })
  }
}
