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

      // the ?? are placeholders in the check instead of hardcoding the names then you pass column names in the array as strings. From Knex.js docs https://knexjs.org/guide/schema-builder.html#check
      table.check("?? IN ('payment_failure', 'group_removal')", ['type'], 'chk_grace_type')
      table.check(
        "?? IN ('free', 'individual_paid', 'group_paid')",
        ['original_tier'],
        'chk_grace_original_tier'
      )

      table.index('user_id')
      table.index(['expires_at', 'resolved'])
    })

    // Partial unique index. Deferred to ensure that the dependent columns are created first. See docs at https://lucid.adonisjs.com/docs/migrations#performing-other-database-operations
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
