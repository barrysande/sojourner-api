import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'create_password_reset_tokens'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('email').notNullable().index()
      table.string('token').notNullable().unique()
      table.timestamp('expires_at').notNullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
      table.timestamp('used_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
