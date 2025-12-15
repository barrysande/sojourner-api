import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'hidden_gems'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['latitude', 'longitude'])
      table.dropColumn('latitude')
      table.dropColumn('longitude')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.decimal('latitude', 10, 8).nullable()
      table.decimal('longitude', 10, 8).nullable()
      table.index(['latitude', 'longitude'])
    })
  }
}
