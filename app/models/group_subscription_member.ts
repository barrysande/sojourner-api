import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import GroupSubscription from './group_subscription.js'
import User from './user.js'

export default class GroupSubscriptionMember extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare groupSubscriptionId: number

  @column()
  declare userId: number

  @column.dateTime()
  declare joinedAt: DateTime

  @column()
  declare status: 'active' | 'removed'

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => GroupSubscription)
  declare groupSubscription: BelongsTo<typeof GroupSubscription>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
