import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'remember_me_tokens'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('tokenable_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('hash', 255).notNullable().unique()
      table.timestamp('created_at')
      table.timestamp('updated_at')
      table.timestamp('expires_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
