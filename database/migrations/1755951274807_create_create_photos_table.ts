import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'photos'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('hidden_gem_id')
        .unsigned()
        .references('id')
        .inTable('hidden_gems')
        .onDelete('CASCADE')
      table.string('file_path', 500).notNullable()
      table.string('file_name', 255).notNullable()
      table.string('caption', 500).nullable()
      table.boolean('is_primary').defaultTo(false)
      table.integer('file_size').nullable()
      table.string('mime_type', 100).nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.index('hidden_gem_id')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
