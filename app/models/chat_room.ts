import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import ShareGroup from './share_group.js'

export default class ChatRoom extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare shareGroupId: number

  @column()
  declare roomName: string | null

  @column()
  declare lastActivityAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => ShareGroup)
  declare shareGroup: BelongsTo<typeof ShareGroup>

  @hasMany(() => ChatRoom)
  declare messages: HasMany<typeof ChatRoom>

  async updateLastActivity() {
    this.lastActivityAt = DateTime.now()
    await this.save()
  }
}
