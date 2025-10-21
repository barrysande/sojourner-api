import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'

export default class GracePeriod extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare type: 'payment_failure' | 'group_removal'

  @column()
  declare originalTier: 'free' | 'individual_paid' | 'group_paid'

  @column.dateTime()
  declare startedAt: DateTime

  @column.dateTime()
  declare expiresAt: DateTime

  @column()
  declare resolved: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
