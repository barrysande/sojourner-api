import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'social_authentications'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE')
      table.string('provider_name').notNullable()
      table.string('provider_id').notNullable()
      table.string('email').notNullable()
      table.string('avatar_url').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at')

      table.unique(['provider_name', 'provider_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
