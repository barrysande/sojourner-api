import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'share_group_members'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('share_group_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('share_groups')
        .onDelete('CASCADE')

      table
        .integer('user_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table
        .integer('invited_by')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.enum('status', ['pending', 'active', 'left']).defaultTo('pending')
      table.enum('role', ['creator', 'member']).defaultTo('member')
      table.timestamp('invited_at').defaultTo(this.now())
      table.timestamp('joined_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.unique(['share_group_id', 'user_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
