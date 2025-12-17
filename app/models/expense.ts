import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import HiddenGem from './hidden_gem.js'

export default class Expense extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare hiddenGemId: number

  @column()
  declare description: string

  @column()
  declare amount: number

  @column()
  declare currency: string

  @column()
  declare name: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => HiddenGem)
  declare hiddenGem: BelongsTo<typeof HiddenGem>
}
