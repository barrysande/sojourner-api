import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'expenses'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('hidden_gem_id')
        .unsigned()
        .references('id')
        .inTable('hidden_gems')
        .onDelete('CASCADE')

      table.string('description', 255).notNullable()
      table.decimal('amount', 10, 2).notNullable()
      table.string('currency', 3).defaultTo('KES')
      table.string('category', 100).nullable()
      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.index('hidden_gem_id', 'idx_hidden_gem_id')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
