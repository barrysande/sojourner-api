import ChatMessage, { MessageType, SystemMessageMetadata } from '#models/chat_message'
import ChatRoom from '#models/chat_room'
import ShareGroup from '#models/share_group'
import User from '#models/user'
import ShareGroupMember from '#models/share_group_member'
import { DateTime } from 'luxon'

export class ChatService {
  async createChatRoomForGroup(shareGroupId: number): Promise<ChatRoom> {
    return await ChatRoom.create({ shareGroupId, lastActivityAt: DateTime.now() })
  }

  async getChatRoomByGroupId(shareGroupId: number): Promise<ChatRoom | null> {
    return await ChatRoom.query()
      .where('share_group_id', shareGroupId)
      .preload('shareGroup')
      .first()
  }

  async createOrFindChatRoom(shareGroupId: number): Promise<ChatRoom> {
    let chatRoom = await this.getChatRoomByGroupId(shareGroupId)

    if (!chatRoom) {
      chatRoom = await this.createChatRoomForGroup(shareGroupId)
      chatRoom.load('shareGroup')
    }

    return chatRoom
  }

  async saveMessage(
    roomId: number,
    userId: number,
    message: string,
    type: MessageType = 'text',
    metadata: SystemMessageMetadata | null = null
  ): Promise<ChatMessage> {
    // 1. check for message limit 2. save the chat message 3. update last activity.
    if (message.length > 280) {
      throw new Error('Message exceeds 280 character limit.')
    }

    const chatMessage = await ChatMessage.create({
      chatRoomId: roomId,
      userId,
      message: message.trim(),
      messageType: type,
      metadata,
    })

    const chatRoom = await ChatRoom.findOrFail(roomId)
    chatRoom.updateLastActivity()

    return chatMessage
  }

  async getChatHistory(roomId: number, page: number = 1, limit: number = 30) {
    const messages = await ChatMessage.query()
      .where('chat_room_id', roomId)
      .preload('user', (query) => {
        query.select('id', 'full_name', 'email')
      })
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    messages.reverse()

    return {
      messages: messages.map((msg) => msg.toJSON()),
      pagination: {
        page: messages.currentPage,
        perPage: messages.perPage,
        total: messages.total,
      },
    }
  }

  async validateChatAccess(userId: number, shareGroupId: number): Promise<boolean> {
    const membership = await ShareGroupMember.query()
      .where('user_id', userId)
      .where('share_group_id', shareGroupId)
      .where('status', 'active')
      .first()

    return !!membership
  }
}
