import ChatMessage, { type MessageType, type SystemMessageMetadata } from '#models/chat_message'
import ChatRoom from '#models/chat_room'
import User from '#models/user'
import ShareGroupMember from '#models/share_group_member'
import HiddenGem from '#models/hidden_gem'
import ShareGroup from '#models/share_group'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'

export class ChatService {
  private readonly MAX_MESSAGE_LENGTH = 2000

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
      try {
        chatRoom = await this.createChatRoomForGroup(shareGroupId)
        await chatRoom.load('shareGroup')
      } catch (error) {
        // Handle duplicate key violation (PostgreSQL code 23505)
        if (error.code === '23505') {
          chatRoom = await this.getChatRoomByGroupId(shareGroupId)
          if (!chatRoom) {
            throw new Error('Failed to create or find chat room after race condition')
          }
        } else {
          throw error
        }
      }
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
    const trimmedMessage = message.trim()
    if (trimmedMessage.length === 0) {
      throw new Error('Message cannot be empty')
    }

    if (trimmedMessage.length > this.MAX_MESSAGE_LENGTH) {
      throw new Error(`Message exceeds the ${this.MAX_MESSAGE_LENGTH} character limit`)
    }

    const chatMessage = await ChatMessage.create({
      chatRoomId: roomId,
      userId,
      message: trimmedMessage,
      messageType: type,
      metadata,
    })

    const chatRoom = await ChatRoom.findOrFail(roomId)
    await chatRoom.updateLastActivity()

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

    // https://lucid.adonisjs.com/docs/model-query-builder#paginate
    const serialized = messages.serialize()

    return {
      messages: serialized.data.reverse(),
      meta: serialized.meta,
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
    const userMemberships = await ShareGroupMember.query()
      .where('user_id', userId)
      .where('status', 'active')
      .select('share_group_id')

    const groupIds = userMemberships.map((m) => m.shareGroupId)

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

    const chatRoom = await this.createOrFindChatRoom(shareGroupId)

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
    if (gemIds.length === 0) {
      throw new Error('Cannot create gem shared message without gems.')
    }
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

    const deletedCount = await ChatMessage.query()
      .where('chat_room_id', chatRoom.id)
      .where('user_id', userId)
      .delete()

    logger.info(`Deleted ${deletedCount[0]} messages for user ${userId} from group ${shareGroupId}`)
    return deletedCount[0]
  }

  async deleteChatRoom(shareGroupId: number): Promise<void> {
    const chatRoom = await this.getChatRoomByGroupId(shareGroupId)

    if (!chatRoom) return

    await chatRoom.delete()
  }
}
