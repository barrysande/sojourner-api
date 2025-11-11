import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'photos'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table
        .integer('hidden_gem_id')
        .unsigned()
        .references('id')
        .inTable('hidden_gems')
        .onDelete('CASCADE')

      // R2 storage key (path within bucket)
      // e.g., "users/123/gems/456/photo-uuid.webp"
      table.string('storage_key', 500).notNullable()

      // Public URL to access the image
      // e.g., "https://pub-xxxxx.r2.dev/users/123/gems/456/photo-uuid.webp"
      table.string('url', 500).notNullable()

      // Optional: Thumbnail URL for list views
      // e.g., "https://pub-xxxxx.r2.dev/users/123/gems/456/photo-uuid-thumb.webp"
      table.string('thumbnail_url', 500).nullable()

      // Original filename from user upload
      table.string('original_file_name', 255).notNullable()

      // Optional caption for the photo
      table.string('caption', 500).nullable()

      // Mark which photo is the primary/cover photo
      table.boolean('is_primary').defaultTo(false)

      // File metadata
      table.integer('file_size').notNullable() // in bytes
      table.string('mime_type', 100).notNullable() // e.g., "image/webp"

      table.integer('width').nullable()
      table.integer('height').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.index('hidden_gem_id', 'idx_hidden_gem_id')
      table.index(['hidden_gem_id', 'is_primary'], 'idx_isprimary_hidden_gem_id')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
