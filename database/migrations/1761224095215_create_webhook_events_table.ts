import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'webhook_events'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('event__id', 255).notNullable().unique()
      table.string('event_type', 100).notNullable()
      table.string('resource_id', 255).notNullable()
      table.timestamp('processed_at').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at')

      table.index(['event_type', 'resource_id'], 'idx_webhook_events_resource')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
