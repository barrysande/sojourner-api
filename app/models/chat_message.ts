import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import ChatRoom from './chat_room.js'
import User from './user.js'

export type MessageType = 'text' | 'system'

export interface SystemMessageMetadata {
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

  @column()
  declare metadata: SystemMessageMetadata | null

  @column.dateTime({
    autoCreate: true,
  })
  declare createdAt: DateTime

  @belongsTo(() => ChatRoom, {
    serializeAs: null,
  })
  declare chatRoom: BelongsTo<typeof ChatRoom>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
