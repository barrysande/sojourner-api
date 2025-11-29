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
      table.string('dodo_session_id', 255).notNullable().unique()
      table.string('dodo_subscription_id', 255).nullable().unique()
      table.string('plan_type', 50).notNullable()
      table.integer('total_seats').notNullable()
      table.string('invite_code', 50).notNullable().unique()
      table.timestamp('invite_code_expires_at').notNullable()
      table.string('status', 50).notNullable()
      table.timestamp('expires_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      //the ?? are placeholders in the check instead of hardcoding the names then you pass column names in the array as strings. From Knex.js docs https://knexjs.org/guide/schema-builder.html#check
      table.check(
        "?? IN ('pending', 'active', 'on_hold', 'cancelled', 'failed', 'expired')",
        ['status'],
        'chk_group_status'
      )
      table.check('?? >= 1 AND ?? <= 50', ['total_seats', 'total_seats'], 'chk_group_seats_range')

      table.index('owner_user_id')
      table.index('dodo_subscription_id')
      table.index('invite_code')
      table.index('dodo_session_id')
    })

    this.defer(async (db) => {
      await db.rawQuery(
        `CREATE UNIQUE INDEX one_active_plan_per_owner 
         ON ${this.tableName} (owner_user_id) 
         WHERE status = 'active'`
      )
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
