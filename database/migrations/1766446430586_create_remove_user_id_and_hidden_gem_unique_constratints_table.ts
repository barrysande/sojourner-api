import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('shared_gems', (table) => {
      table.dropUnique(['hidden_gem_id', 'user_id'])
    })
  }

  async down() {
    this.schema.alterTable('shared_gems', (table) => {
      table.unique(['hidden_gem_id', 'user_id'])
    })
  }
}
