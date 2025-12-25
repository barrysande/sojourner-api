import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'group_subscription_members'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('user_id').unsigned().notNullable().alter()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.bigInteger('user_id').unsigned().notNullable().alter()
    })
  }
}
