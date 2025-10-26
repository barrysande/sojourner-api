import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'

export default class CustomerBillingAddress extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare city: string

  @column()
  declare country: string

  @column()
  declare state: string

  @column()
  declare street: string

  @column()
  declare zipcode: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
