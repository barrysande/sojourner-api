import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'notifications'

  async up() {
    // 1. Drop the old constraint if it exists (safety check)
    await this.db.rawQuery(
      'ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check'
    )

    // 2. Convert column to TEXT.
    // The "USING type::text" is CRITICAL: it tells Postgres how to convert the old Enum data to String.
    await this.db.rawQuery('ALTER TABLE notifications ALTER COLUMN type TYPE TEXT USING type::text')

    // 3. Add the new Check Constraint (including 'grace_period')
    await this.db.rawQuery(`
      ALTER TABLE notifications 
      ADD CONSTRAINT notifications_type_check 
      CHECK (type IN (
        'share_group_invite', 
        'gem_shared', 
        'group_joined', 
        'group_left', 
        'group_dissolved', 
        'grace_period'
      ))
    `)
  }

  async down() {
    // 1. Drop the new constraint
    await this.db.rawQuery(
      'ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check'
    )

    // 2. Revert to the OLD constraint list (but keep as TEXT for safety)
    // Going back to a native Enum type is dangerous if you have 'grace_period' data
    // because the old Enum won't support it and the rollback would crash.
    await this.db.rawQuery(`
      ALTER TABLE notifications 
      ADD CONSTRAINT notifications_type_check 
      CHECK (type IN (
        'share_group_invite', 
        'gem_shared', 
        'group_joined', 
        'group_left', 
        'group_dissolved'
      ))
    `)
  }
}
