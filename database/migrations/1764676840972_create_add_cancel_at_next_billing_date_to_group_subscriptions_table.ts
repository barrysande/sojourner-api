import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'group_subscriptions'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('cancel_at_next_billing_date').defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('cancel_at_next_billing_date')
    })
  }
}
