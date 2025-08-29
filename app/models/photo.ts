import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import HiddenGem from './hidden_gem.js'

export default class Photo extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare hiddenGemId: number

  @column()
  declare cloudinaryUrl: string

  @column()
  declare cloudinaryPublicId: string

  @column()
  declare cloudinarySecureUrl: string

  @column()
  declare fileName: string

  @column()
  declare caption: string | null

  @column()
  declare isPrimary: boolean

  @column()
  declare fileSize: number | null

  @column()
  declare mimeType: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // Relationships
  @belongsTo(() => HiddenGem)
  declare hiddenGem: BelongsTo<typeof HiddenGem>
}
