import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'email_verification_tokens'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table.string('token_hash').notNullable().unique()

      table.string('type').notNullable()
      table.timestamp('expires_at').notNullable
      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.index('user_id', 'idx_user')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
