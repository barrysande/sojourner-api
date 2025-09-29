import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'chat_rooms'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('share_group_id')
        .unsigned()
        .references('id')
        .inTable('share_groups')
        .onDelete('CASCADE')
        .unique()
      table.string('room_name', 255).unique().nullable()

      table.timestamp('last_activity_at').defaultTo(this.now())
      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.index(['share_group_id'], 'chat_rooms_share_group_index')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
