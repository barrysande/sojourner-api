import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'remember_me_tokens'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('created_at').notNullable().alter()
      table.timestamp('updated_at').notNullable().alter()
      table.timestamp('expires_at').notNullable().alter()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('created_at').nullable().alter()
      table.timestamp('updated_at').nullable().alter()
      table.timestamp('expires_at').nullable().alter()
    })
  }
}
