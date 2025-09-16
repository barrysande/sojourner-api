import { BaseSchema } from '@adonisjs/lucid/schema'
export default class extends BaseSchema {
  protected tableName = 'share_groups'
  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.index(['invite_code'])
      table.index(['created_by'])
    })
  }
  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['invite_code'])
      table.dropIndex(['created_by'])
    })
  }
}
