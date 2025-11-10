import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'

export default class TierAuditLog extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare oldTier: 'free' | 'individual_paid' | 'group_paid'

  @column()
  declare newTier: 'free' | 'individual_paid' | 'group_paid'

  @column()
  declare reason: string

  @column()
  declare triggeredBy: 'webhook' | 'manual' | 'cron' | 'join' | 'leave'

  @column()
  declare metadata: Record<string, any> | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
