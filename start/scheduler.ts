import scheduler from 'adonisjs-scheduler/services/main'
import ProcessJobs from '../commands/process_jobs.js'
import CleanupPasswordTokens from '../commands/cleanup_password_tokens.js'
import ProcessWebhooks from '../commands/process_webhooks.js'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

scheduler.command(ProcessJobs).everyFiveSeconds().withoutOverlapping()
scheduler.command(ProcessWebhooks).everyFiveSeconds().withoutOverlapping()
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

// TODO
// 1. Create a scheduler for cleaning email verification records - quarterly.
// 2. Create a scheduler for cleaning password reset records - quarterly.
