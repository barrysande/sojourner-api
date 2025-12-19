import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'post_visit_notes'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('visited')
      table.dropColumn('rating')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('visited').defaultTo(false).notNullable()
      table.integer('rating').unsigned().nullable()
    })
  }
}
