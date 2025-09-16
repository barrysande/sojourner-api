import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'shared_gems'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.unique(['hidden_gem_id', 'share_group_id'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropUnique(['hidden_gem_id', 'share_group_id'])
    })
  }
}
