import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'post_visit_notes'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('hidden_gem_id')
        .unsigned()
        .references('id')
        .inTable('hidden_gems')
        .onDelete('CASCADE')

      table.text('content').notNullable()
      table.boolean('visited').defaultTo(false).notNullable()
      table.integer('rating').unsigned().nullable().checkBetween([1, 5])
      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.index('hidden_gem_id')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
