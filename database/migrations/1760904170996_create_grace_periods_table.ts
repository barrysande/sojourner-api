import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'grace_periods'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id').primary()
      table
        .bigInteger('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('type', 50).notNullable()
      table.string('original_tier', 50).notNullable()
      table.timestamp('started_at').notNullable()
      table.timestamp('expires_at').notNullable()
      table.boolean('resolved').notNullable().defaultTo(false)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      // CHECK constraints
      table.check("type IN ('payment_failure', 'group_removal')", [], 'chk_grace_type')
      table.check(
        "original_tier IN ('free', 'individual_paid', 'group_paid')",
        [],
        'chk_grace_original_tier'
      )

      table.index('user_id', 'idx_grace_periods_user')
      table.index(['expires_at', 'resolved'], 'idx_grace_periods_expiry')
    })

    // Partial unique index
    this.defer(async (db) => {
      await db.rawQuery(
        `CREATE UNIQUE INDEX one_active_grace_per_user 
         ON ${this.tableName} (user_id, resolved) 
         WHERE resolved = false`
      )
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
