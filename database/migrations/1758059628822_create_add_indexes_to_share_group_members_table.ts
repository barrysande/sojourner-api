import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'share_group_members'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.index(['user_id'])
      table.index(['share_group_id'])
      table.index(['user_id', 'status'])
      table.index(['share_group_id', 'status'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['user_id'])
      table.dropIndex(['share_group_id'])
      table.dropIndex(['user_id', 'status'])
      table.dropIndex(['share_group_id', 'status'])
    })
  }
}
