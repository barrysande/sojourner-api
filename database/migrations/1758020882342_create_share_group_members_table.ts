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
      table.string('status', 50).notNullable().defaultTo('pending')
      table.string('role', 50).notNullable().defaultTo('member')
      table.timestamp('invited_at').defaultTo(this.now())
      table.timestamp('joined_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.check(
        "?? IN ('pending', 'active', 'left')",
        ['status'],
        'chk_share_group_members_status'
      )
      table.check("?? IN ('creator', 'member')", ['role'], 'chk_share_group_members_role')

      table.unique(['share_group_id', 'user_id'])

      table.index('user_id')
      table.index('share_group_id')
      table.index(['user_id', 'status'])
      table.index(['share_group_id', 'status'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
