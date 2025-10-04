import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'chat_messages'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('chat_room_id')
        .unsigned()
        .references('id')
        .inTable('chat_rooms')
        .onDelete('CASCADE')

      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE')

      table.text('message').notNullable()
      table.enum('message_type', ['text', 'system']).defaultTo('text')
      table.json('metadata').nullable()

      table.index(['chat_room_id', 'created_at'], 'chat_messages_room_time_index')
      table.index(['user_id'], 'chat_messages_use_index')

      table.timestamp('created_at').defaultTo(this.now()).notNullable()
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
