import scheduler from 'adonisjs-scheduler/services/main'
import ProcessJobs from '../commands/process_jobs.js'
import CleanupPasswordTokens from '../commands/cleanup_password_tokens.js'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

scheduler.command(ProcessJobs).everyFiveSeconds().withoutOverlapping()
scheduler.command(CleanupPasswordTokens).quarterly().withoutOverlapping()

scheduler
  .call(async () => {
    const threeMonthsAgo = DateTime.now().minus({ months: 3 }).toSQL()

    await db
      .from('jobs')
      .whereIn('status', ['processed', 'failed'])
      .where('created_at', '<', threeMonthsAgo)
      .delete()
  })
  .quarterly()
  .withoutOverlapping()
