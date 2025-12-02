import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import GroupSubscriptionMember from './group_subscription_member.js'

export default class GroupSubscription extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare ownerUserId: number

  @column()
  declare dodoSessionId: string

  @column()
  declare dodoSubscriptionId: string | null

  @column()
  declare dodoCustomerId: string | null

  @column()
  declare cancelAtNextBillingDate: boolean

  @column()
  declare planType: 'monthly' | 'quarterly' | 'annual'

  @column()
  declare totalSeats: number

  @column()
  declare inviteCode: string

  @column.dateTime()
  declare inviteCodeExpiresAt: DateTime

  @column()
  declare status: 'pending' | 'active' | 'on_hold' | 'cancelled' | 'failed' | 'expired'

  @column.dateTime()
  declare expiresAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User, { foreignKey: 'ownerUserId' })
  declare owner: BelongsTo<typeof User>

  @hasMany(() => GroupSubscriptionMember)
  declare members: HasMany<typeof GroupSubscriptionMember>
}
