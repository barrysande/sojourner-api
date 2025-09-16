import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany, BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import ShareGroupMember from './share_group_member.js'
import SharedGem from './shared_gem.js'

export default class ShareGroup extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare inviteCode: string

  @column()
  declare createdBy: number

  @column()
  declare maxMembers: number

  @column()
  declare status: 'active' | 'dissolved'

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  @hasMany(() => ShareGroupMember)
  declare members: HasMany<typeof ShareGroupMember>

  @hasMany(() => SharedGem)
  declare sharedGems: HasMany<typeof SharedGem>
}
