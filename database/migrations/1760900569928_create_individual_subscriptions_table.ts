import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'individual_subscriptions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .bigInteger('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('dodo_session_id', 255).notNullable().unique()
      table.string('dodo_subscription_id', 255).nullable().unique()
      table.string('dodo_customer_id', 255).nullable()
      table.string('plan_type', 50).notNullable()
      table.string('status', 50).notNullable()
      table.timestamp('expires_at').nullable()
      table.timestamp('created_at')
      table.timestamp('updated_at')

      //the ?? are placeholders in the check instead of hardcoding the names then you pass column names in the array as strings. From Knex.js docs https://knexjs.org/guide/schema-builder.html#check
      table.check(
        "?? IN ('monthly', 'quarterly', 'annual')",
        ['plan_type'],
        'chk_individual_plan_type'
      )

      table.check(
        "?? IN ('pending', 'active', 'on_hold', 'cancelled', 'failed', 'expired')",
        ['status'],
        'chk_individual_status'
      )

      table.index('user_id')
      table.index('dodo_subscription_id')
      table.index(['status', 'expires_at'])
      table.index('dodo_session_id')
    })

    this.defer(async (db) => {
      await db.rawQuery(
        `CREATE UNIQUE INDEX one_active_plan_per_user 
         ON ${this.tableName} (user_id) 
         WHERE status = 'active'`
      )
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
