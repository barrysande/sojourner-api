import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'group_subscriptions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id').primary()
      table
        .bigInteger('owner_user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('dodo_subscription_id', 255).notNullable().unique()
      table.integer('total_seats').notNullable()
      table.string('invite_code', 8).notNullable().unique()
      table.timestamp('invite_code_expires_at').notNullable()
      table.string('status', 50).notNullable()
      table.timestamp('expires_at').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.check("status IN ('active', 'cancelled', 'expired')", [], 'chk_group_status')
      table.check('total_seats >= 10 AND total_seats <= 50', [], 'chk_group_seats_range')

      table.index('owner_user_id', 'idx_group_subs_owner')
      table.index('dodo_subscription_id', 'idx_group_subs_dodo')
      table.index('invite_code', 'idx_group_subs_code')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
