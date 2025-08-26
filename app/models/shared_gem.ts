import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import HiddenGem from './hidden_gem.js'
import User from './user.js'

export default class SharedGem extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare hiddenGemId: number

  @column()
  declare userId: number

  @column()
  declare permissionLevel: 'view' | 'edit' | 'admin'

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // Relationships
  @belongsTo(() => HiddenGem)
  declare hiddenGem: BelongsTo<typeof HiddenGem>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
