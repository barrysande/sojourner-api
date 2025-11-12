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
  declare storageKey: string

  @column()
  declare url: string

  @column()
  declare thumbnailUrl: string | null

  @column()
  declare originalFileName: string

  @column()
  declare caption: string | null

  @column()
  declare isPrimary: boolean

  @column()
  declare fileSize: number

  @column()
  declare mimeType: string

  @column()
  declare width: number | null

  @column()
  declare height: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => HiddenGem)
  declare hiddenGem: BelongsTo<typeof HiddenGem>
}
