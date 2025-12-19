import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'hidden_gems'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('visited').defaultTo(false).notNullable()
      table.integer('rating').unsigned().nullable().checkBetween([1, 5])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('visited')
      table.dropColumn('rating')
    })
  }
}
