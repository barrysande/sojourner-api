import scheduler from 'adonisjs-scheduler/services/main'
import ProcessJobs from '../commands/process_jobs.js'
import CleanupPasswordTokens from '../commands/cleanup_password_tokens.js'
import ProcessWebhooks from '../commands/process_webhooks.js'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import ExpiredGracePeriods from '../commands/expired_grace_periods.js'
import CleanExpiredTokens from '../commands/clean_expired_tokens.js'

scheduler.command(ExpiredGracePeriods).everyFifteenMinutes().withoutOverlapping()

scheduler.command(CleanExpiredTokens).quarterly().withoutOverlapping()

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
