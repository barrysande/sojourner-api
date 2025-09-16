import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'shared_gems'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
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
      table.timestamp('shared_at').defaultTo(this.now())
      table.index(['share_group_id'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('share_group_id')
      table.dropColumn('shared_by')
      table.dropColumn('shared_at')
    })
  }
}
