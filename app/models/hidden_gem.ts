import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import User from './user.js'
import Expense from './expense.js'
import Photo from './photo.js'
import SharedGem from './shared_gem.js'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

export default class HiddenGem extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare name: string

  @column()
  declare location: string
  @column()
  declare description: string

  @column()
  declare isPublic: boolean

  @column()
  declare locked: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User)
  declare owner: BelongsTo<typeof User>

  @hasMany(() => Expense)
  declare expenses: HasMany<typeof Expense>

  @hasMany(() => Photo)
  declare photos: HasMany<typeof Photo>

  @hasMany(() => SharedGem)
  declare sharedWith: HasMany<typeof SharedGem>
}
