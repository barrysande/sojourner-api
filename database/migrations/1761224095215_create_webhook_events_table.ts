import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'webhook_events'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('event_id', 255).notNullable().unique()
      table.string('event_type', 100).notNullable()
      table.string('business_id', 255).notNullable()
      table.jsonb('payload').notNullable()
      table.string('status', 50).notNullable()
      table.integer('attempts').notNullable().defaultTo(0)
      table.text('last_error').nullable()
      table.timestamp('processed_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      //the ?? are placeholders in the check instead of hardcoding the names then you pass column names in the array as strings. From Knex.js docs https://knexjs.org/guide/schema-builder.html#check
      table.check(
        "?? IN ('pending', 'processing', 'completed', 'failed')",
        ['status'],
        'chk_status_type'
      )

      table.index(['event_type'], 'idx_webhook_events')
      table.index(['status', 'created_at'], 'idx_webhook_status_created')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
