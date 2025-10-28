import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'group_subscription_members'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id').primary()
      table
        .bigInteger('group_subscription_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('group_subscriptions')
        .onDelete('CASCADE')
      table
        .bigInteger('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.timestamp('joined_at').notNullable()
      table.string('status', 50).notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.check("status IN ('active', 'removed')", [], 'chk_member_status')

      table.index('group_subscription_id', 'idx_group_members_sub')
      table.index('user_id', 'idx_group_members_user')
      table.index('status', 'idx_group_members_status')
    })

    // Partial unique index. Deferred to ensure that the dependent columns are created first. See docs at https://lucid.adonisjs.com/docs/migrations#performing-other-database-operations
    this.defer(async (db) => {
      await db.rawQuery(
        `CREATE UNIQUE INDEX one_active_subscription_per_user ON ${this.tableName}(user_id) WHERE status = 'active'`
      )
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
