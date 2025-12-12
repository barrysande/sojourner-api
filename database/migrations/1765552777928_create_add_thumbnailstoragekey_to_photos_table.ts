import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'photos'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('thumbnail_storage_key').nullable()
      table.dropColumn('url')
      table.dropColumn('thumbnail_url')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('url').nullable()
      table.string('thumbnail_url').nullable()
      table.dropColumn('thumbnail_storage_key')
    })
  }
}
