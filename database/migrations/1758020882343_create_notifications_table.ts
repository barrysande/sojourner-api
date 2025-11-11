import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'notifications'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('user_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table
        .enum('type', [
          'share_group_invite',
          'gem_shared',
          'group_joined',
          'group_left',
          'group_dissolved',
        ])
        .notNullable()
      table.string('title').notNullable()
      table.text('message').notNullable()
      table.json('data').nullable()
      table.boolean('is_read').defaultTo(false)
      table.timestamp('sent_at').defaultTo(this.now())

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.index(['user_id'])
      table.index(['user_id', 'is_read'])
      table.index(['user_id', 'sent_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
