import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'photos'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('file_path')

      table.string('cloudinary_url', 500).notNullable()
      table.string('cloudinary_public_id', 500).notNullable()
      table.string('cloudinary_secure_url', 500).notNullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('file_path', 500).notNullable()

      table.dropColumn('cloudinary_url')
      table.dropColumn('cloudinary_public_id')
      table.dropColumn('cloudinary_secure_url')
    })
  }
}
