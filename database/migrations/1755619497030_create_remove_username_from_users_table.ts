import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  // Make sure this table name matches your 'users' table
  protected tableName = 'users'

  public async up() {
    const hasColumn = await this.schema.hasColumn(this.tableName, 'username')

    if (hasColumn) {
      this.schema.alterTable(this.tableName, (table) => {
        table.dropColumn('username')
      })
    }
  }

  public async down() {
    const hasColumn = await this.schema.hasColumn(this.tableName, 'username')

    if (!hasColumn) {
      this.schema.alterTable(this.tableName, (table) => {
        table.string('username').notNullable().unique()
      })
    }
  }
}
