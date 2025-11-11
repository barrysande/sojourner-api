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
      table.string('message_type', 50).notNullable().defaultTo('text')
      table.json('metadata').nullable()

      table.check("?? IN ('text', 'system')", ['message_type'], 'chk_chat_messages_message_type')

      table.index(['chat_room_id', 'created_at'])
      table.index(['user_id'])

      table.timestamp('created_at').defaultTo(this.now()).notNullable()
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
