import { BaseSchema } from '@adonisjs/lucid/schema'
export default class extends BaseSchema {
  protected tableName = 'notifications'
  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.index(['user_id'])
      table.index(['user_id', 'sent_at'])
    })
  }
  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['user_id'])
      table.dropIndex(['user_id', 'sent_at'])
    })
  }
}
