import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'shared_gems'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('hidden_gem_id')
        .unsigned()
        .references('id')
        .inTable('hidden_gems')
        .onDelete('CASCADE')
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE')
      table.enum('permission_level', ['view', 'edit', 'admin']).defaultTo('view')
      table.timestamp('created_at')
      table.timestamp('updated_at')

      // Add indexes and unique constraint
      table.index('hidden_gem_id')
      table.index('user_id')
      table.unique(['hidden_gem_id', 'user_id']) // Prevent duplicate shares
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
