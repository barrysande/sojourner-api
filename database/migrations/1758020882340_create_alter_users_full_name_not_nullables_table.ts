import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.defer(async (db) => {
      await db.from(this.tableName).whereNull('full_name').update({ full_name: 'User' })
    })
    this.schema.alterTable(this.tableName, (table) => {
      table.string('full_name').notNullable().alter()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('full_name').nullable().alter()
    })
  }
}
