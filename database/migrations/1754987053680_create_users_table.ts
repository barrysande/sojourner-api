import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('full_name').notNullable()
      table.string('email', 254).notNullable().unique()
      table.string('password').notNullable()
      table.string('tier', 50).notNullable().defaultTo('free')
      table.timestamp('email_verified_at').nullable()
      table.timestamp('tier_updated_at').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.check("?? IN ('free', 'individual_paid', 'group_paid')", ['tier'], 'chk_users_tier')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
