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
      table.string('dodo_subscription_id', 255).notNullable().unique()
      table.string('plan_type', 50).notNullable()
      table.string('status', 50).notNullable()
      table.timestamp('expires_at').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at')

      table.check("plan_type IN ('monthly', 'quarterly', 'annual')", [], 'chk_individual_plan_type')

      table.check("status IN ('active', 'cancelled', 'expired') ", [], 'chk_individual_status')

      table.index('user_id', 'idx_individual_subs_user')
      table.index('dodo_subscription_id', 'idx_individual_subs_dodo')
      table.index(['status', 'expires_at'], 'idx_individual_subs_status')
    })

    // Partial unique index. Deferred to ensure that the dependent columns are created first. See docs at https://lucid.adonisjs.com/docs/migrations#performing-other-database-operations
    this.defer(async (db) => {
      await db.rawQuery(
        `CREATE UNIQUE INDEX one_active_plan_per_user 
         ON ${this.tableName} (user_id, status) 
         WHERE status = 'active'`
      )
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
