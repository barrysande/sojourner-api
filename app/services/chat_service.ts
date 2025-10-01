import ChatMessage, { MessageType, SystemMessageMetadata } from '#models/chat_message'
import ChatRoom from '#models/chat_room'
import User from '#models/user'
import ShareGroupMember from '#models/share_group_member'
import { DateTime } from 'luxon'
import HiddenGem from '#models/hidden_gem'
import ShareGroup from '#models/share_group'
import logger from '@adonisjs/core/services/logger'

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

  async getUserChatRooms(userId: number) {
    const activeMemberships = await ShareGroupMember.query()
      .where('user_id', userId)
      .where('status', 'active')
      .select('share_group_id')

    const groupIds = activeMemberships.map((m) => m.shareGroupId)

    if (groupIds.length === 0) {
      return []
    }

    const chatRooms = await ChatRoom.query()
      .whereIn('share_group_id', groupIds)
      .preload('shareGroup')
      .orderBy('last_activity_at', 'desc')

    return chatRooms.map((room) => room.toJSON())
  }

  async createGroupJoinedSystemMessage(
    shareGroupId: number,
    newUserId: number
  ): Promise<ChatMessage> {
    const newUser = await User.findOrFail(newUserId)

    const chatRoom = await this.createChatRoomForGroup(shareGroupId)

    return await this.saveMessage(
      chatRoom.id,
      newUserId,
      `${newUser.fullName} joined the group`,
      'system',
      {
        action: 'user_joined',
        targetUserId: newUserId,
        targetUserName: newUser.fullName,
      }
    )
  }

  async createGroupLeftSystemMessage(
    shareGroupId: number,
    leftUserId: number
  ): Promise<ChatMessage> {
    const leftUser = await User.findOrFail(leftUserId)
    const chatRoom = await this.createOrFindChatRoom(shareGroupId)

    return await this.saveMessage(
      chatRoom.id,
      leftUserId,
      `${leftUser.fullName} left the group`,
      'system',
      {
        action: 'user_left',
        targetUserId: leftUserId,
        targetUserName: leftUser.fullName,
      }
    )
  }

  async createGemSharedSystemMessage(
    shareGroupId: number,
    sharedBy: number,
    gemIds: number[]
  ): Promise<ChatMessage> {
    const sharer = await User.findOrFail(sharedBy)

    const gems = await HiddenGem.query().whereIn('id', gemIds).select('id', 'name')

    const chatRoom = await this.createOrFindChatRoom(shareGroupId)

    const gemNames = gems.map((gem) => gem.name)
    const message =
      gemIds.length === 1
        ? `${sharer.fullName} shared "${gemNames[0]}" with the group`
        : `${sharer.fullName} shared ${gemIds.length} gems with the group`

    return await this.saveMessage(chatRoom.id, sharedBy, message, 'system', {
      action: 'gem_shared',
      gemIds: gemIds,
      gemNames: gemNames,
    })
  }

  async createGroupDissolvedSystemMessage(
    shareGroupId: number,
    dissolvedBy: number
  ): Promise<ChatMessage> {
    const chatRoom = await this.createOrFindChatRoom(shareGroupId)
    const dissolver = await User.findOrFail(dissolvedBy)
    const shareGroup = await ShareGroup.findOrFail(shareGroupId)

    return await this.saveMessage(
      chatRoom.id,
      dissolvedBy,
      `${dissolver.fullName} dissolved the ${shareGroup.name} share group`,
      'system',
      {
        action: 'group_dissolved',
      }
    )
  }

  async deleteUserMessagesFromGroup(userId: number, shareGroupId: number): Promise<number> {
    const chatRoom = await this.getChatRoomByGroupId(shareGroupId)

    if (!chatRoom) return 0

    const deletedMessages = await ChatMessage.query()
      .where('chat_room_id', chatRoom.id)
      .where('user_id', userId)
      .delete()

    logger.info(
      `Deleted ${deletedMessages.length} messages for user ${userId} from group ${shareGroupId}`
    )
    return deletedMessages.length
  }

  async deleteChatRoom(shareGroupId: number): Promise<void> {
    const chatRoom = await this.getChatRoomByGroupId(shareGroupId)

    if (!chatRoom) return

    await chatRoom.delete()
  }
}
