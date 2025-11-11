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
      table
        .integer('share_group_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('share_groups')
        .onDelete('CASCADE')
      table
        .integer('shared_by')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table.string('permission_level', 50).notNullable().defaultTo('view')
      table.timestamp('shared_at').defaultTo(this.now())

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.check(
        "?? IN ('view', 'edit', 'admin')",
        ['permission_level'],
        'chk_shared_gems_permission_level'
      )

      table.index('hidden_gem_id')
      table.index('user_id')
      table.index('share_group_id')

      table.unique(['hidden_gem_id', 'user_id'])
      table.unique(['hidden_gem_id', 'share_group_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
