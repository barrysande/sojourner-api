import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'jobs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('queue_name', 50).notNullable()
      table.jsonb('payload').notNullable()
      table.string('status', 50).notNullable()
      table.integer('priority').notNullable().defaultTo(5)
      table.integer('attempts').notNullable().defaultTo(0)
      table.text('last_error').nullable()
      table.timestamp('scheduled_for').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.check(
        "?? IN ('pending', 'processing', 'completed', 'failed')",
        ['status'],
        'chk_job_status'
      )

      // Decided not to type narrow the types in queue_name column using a table.check on the database so that any future emerging job queue names can be added without making a migration. However, type checking is done in the Job model. That is where to add new queue_name column types.

      table.index(['queue_name', 'status', 'priority', 'created_at'], 'idx_jobs_worker_query')
      table.index(['queue_name', 'status'], 'idx_jobs_queue_status')
      table.index(['created_at'], 'idx_jobs_created')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
