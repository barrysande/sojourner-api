import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import HiddenGem from '#models/hidden_gem'

export default class PostVisitNote extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare hiddenGemId: number

  @column()
  declare content: string

  @column()
  declare visited: boolean

  @column()
  declare rating: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => HiddenGem)
  declare hiddenGem: BelongsTo<typeof HiddenGem>
}
