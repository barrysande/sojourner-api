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

      table.string('storage_key', 500).notNullable()

      table.string('url', 500).notNullable()

      table.string('thumbnail_url', 500).nullable()

      table.string('original_file_name', 255).notNullable()

      table.string('caption', 500).nullable()

      table.boolean('is_primary').defaultTo(false)

      table.integer('file_size').notNullable()
      table.string('mime_type', 100).notNullable()

      table.integer('width').nullable()
      table.integer('height').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.index('hidden_gem_id')
      table.index(['hidden_gem_id', 'is_primary'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
