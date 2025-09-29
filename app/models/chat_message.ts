import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import ChatRoom from './chat_room.js'

type MessageType = 'text' | 'system'

interface SystemMessageMetadata {
  action?: 'user_joined' | 'user_left' | 'gem_shared' | 'group_dissolved'
  targetUserId?: number
  targetUserName?: string
  gemIds?: number[]
  gemNames?: string[]
}

export default class ChatMessage extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare chatRoomId: number

  @column()
  declare userId: number

  @column()
  declare message: string

  @column()
  declare messageType: MessageType

  @column({
    serialize: (value: string | null) => (value ? JSON.parse(value) : null),
    prepare: (value: any) => (value ? JSON.stringify(value) : null),
  })
  declare metadata: SystemMessageMetadata | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => ChatRoom)
  declare chatRoom: BelongsTo<typeof ChatRoom>

  serialize() {
    return {
      id: this.id,
      chatRoomId: this.chatRoomId,
      message: this.message,
      messageType: this.messageType,
      metadata: this.metadata,
      createdAt: this.createdAt.toISO(),
      user: {
        id: this.user.id,
        fullName: this.user.fullName,
        email: this.user.email,
      },
    }
  }
}
