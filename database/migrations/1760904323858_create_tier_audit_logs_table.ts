import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'tier_audit_log'

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
      table.string('old_tier', 50).notNullable()
      table.string('new_tier', 50).notNullable()
      table.text('reason').notNullable()
      table.string('triggered_by', 50).notNullable()
      table.jsonb('metadata').nullable()
      table.timestamp('created_at').notNullable()

      table.check("old_tier IN ('free', 'individual_paid', 'group_paid')", [], 'chk_audit_old_tier')
      table.check("new_tier IN ('free', 'individual_paid', 'group_paid')", [], 'chk_audit_new_tier')
      table.check(
        "triggered_by IN ('webhook', 'manual', 'cron', 'join', 'leave')",
        [],
        'chk_audit_triggered_by'
      )

      table.index(['user_id', 'created_at'], 'idx_tier_audit_user')
      table.index('created_at', 'idx_tier_audit_created')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
