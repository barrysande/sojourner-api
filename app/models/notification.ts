import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, afterCreate } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import transmit from '@adonisjs/transmit/services/main'

type NotificationType =
  | 'share_group_invite'
  | 'gem_shared'
  | 'group_joined'
  | 'group_left'
  | 'group_dissolved'
  | 'grace_period'

export default class Notification extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare type: NotificationType

  @column()
  declare title: string

  @column()
  declare message: string

  @column({})
  declare data: Record<string, any>

  @column()
  declare isRead: boolean

  @column.dateTime()
  declare sentAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  // Hook to transmit notifications to a particular user
  @afterCreate()
  static async broadcastNotification(notification: Notification) {
    const channel = `users/${notification.userId}/notifications`

    const message = notification.serialize()

    transmit.broadcast(channel, message)
  }
}
