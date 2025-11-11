import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'share_groups'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('name').notNullable()
      table.string('invite_code', 8).notNullable().unique()
      table.integer('created_by').unsigned().references('id').inTable('users').onDelete('CASCADE')
      table.integer('max_members').defaultTo(10)
      table.string('status', 50).notNullable().defaultTo('active')

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.check("?? IN ('active', 'dissolved')", ['status'], 'chk_share_groups_status')

      table.index('invite_code')
      table.index('created_by')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
