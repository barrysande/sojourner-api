import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('avatar_key').nullable()
      table.string('avatar_source', 50).nullable().checkIn(['uploaded', 'social'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('avatar_key')
      table.dropColumn('avatar_source')
    })
  }
}
