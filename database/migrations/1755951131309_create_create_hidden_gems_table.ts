import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'hidden_gems'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE')
      table.string('name', 255).notNullable()
      table.string('location', 255).notNullable()
      table.text('description').notNullable()
      table.decimal('latitude', 10, 8).nullable()
      table.decimal('longitude', 10, 8).nullable()
      table.boolean('is_public').defaultTo(false)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.index('user_id')
      table.index(['latitude', 'longitude'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
