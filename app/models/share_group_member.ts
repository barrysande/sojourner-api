import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import ShareGroup from './share_group.js'
import User from './user.js'

export default class ShareGroupMember extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare shareGroupId: number

  @column()
  declare userId: number

  @column()
  declare invitedBy: number

  @column()
  declare status: 'pending' | 'active' | 'left'

  @column()
  declare role: 'creator' | 'member'

  @column.dateTime()
  declare invitedAt: DateTime

  @column.dateTime()
  declare joinedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => ShareGroup)
  declare shareGroup: BelongsTo<typeof ShareGroup>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'invitedBy' })
  declare inviter: BelongsTo<typeof User>
}
