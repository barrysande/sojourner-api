import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'email_verifications_tokens'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .bigInteger('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('token').notNullable()
      table.timestamp('expires_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.index('token', 'idx_token')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
