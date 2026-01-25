import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import WebhookEvent from '#models/webhook_event'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import env from '#start/env'
import app from '@adonisjs/core/services/app'
import Job, { type WebhookJobPayload } from '#models/job'
import WebhookService from '#services/webhook_processor_service'
import db from '@adonisjs/lucid/services/db'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
// import User from '#models/user'

const MAX_JOB_ATTEMPTS = 3
const RETRY_DELAYS = [0, 60, 300]

export default class ProcessWebhooks extends BaseCommand {
  static commandName = 'process:webhooks'
  static description = 'Process pending webhook events from the queue'

  static options: CommandOptions = {
    startApp: true,
    allowUnknownFlags: false,
    staysAlive: false,
  }

  async run() {
    this.logger.info('Webhook worker running: checking for jobs...')

    await this.recoverStuckWebhooks()

    const trx = await db.transaction()

    try {
      const job = await Job.query({ client: trx })
        .where((query) => {
          query.where('status', 'pending').orWhere((subQuery) => {
            subQuery.where('status', 'failed').where('attempts', '<', MAX_JOB_ATTEMPTS)
          })
        })
        .where((query) => {
          query.whereNull('scheduled_for').orWhere('scheduled_for', '<=', DateTime.now().toSQL())
        })
        .where('queue_name', 'webhooks')
        .orderBy('priority', 'asc')
        .orderBy('scheduled_for', 'asc')
        .orderBy('created_at', 'asc')
        .forUpdate()
        .skipLocked()
        .limit(1)
        .first()

      if (!job) {
        this.logger.info('No pending webhook jobs found.')

        await trx.commit()
        return
      }

      const maxAttempts = env.get('WEBHOOK_MAX_ATTEMPTS', 3)

      await this.processJob(job, maxAttempts, trx)

      await trx.commit()
    } catch (error) {
      await trx.rollback()
      this.logger.error('Critical error in webhook worker loop')
    }
  }

  private async processJob(
    job: Job,
    maxAttempts: number,
    trx: TransactionClientContract
  ): Promise<void> {
    const jobLogger = logger.child({
      jobId: job.id,
      attempt: job.attempts + 1,
      maxAttempts: maxAttempts,
    })

    try {
      await job.useTransaction(trx).merge({ status: 'processing' }).save()

      const payload = job.payload as WebhookJobPayload
      const webhookEvent = await WebhookEvent.findOrFail(payload.eventId, { client: trx })

      const webhookService = await app.container.make(WebhookService)
      const processedUser = await webhookService.processWebhookEvent(webhookEvent, trx)

      await webhookEvent
        .useTransaction(trx)
        .merge({
          status: 'completed',
          processedAt: DateTime.now(),
          attempts: webhookEvent.attempts + 1,
        })
        .save()

      if (processedUser) {
        jobLogger.info('Enqueuing payment receipt for user', { userId: processedUser.id })
        await Job.create(
          {
            queueName: 'emails',
            payload: {
              userId: processedUser.id,
              emailType: 'subscription_confirmation',
              metadata: { eventName: webhookEvent.eventType },
            },
            status: 'pending',
            priority: 1,
          },
          { client: trx }
        )
      } else {
        jobLogger.info(
          'Event processed but no user returned (likely an ignored event type). Job complete.'
        )
      }

      await job
        .useTransaction(trx)
        .merge({ status: 'completed', lastError: null, attempts: job.attempts + 1 })
        .save()

      jobLogger.info('Webhook job processed successfully')
    } catch (error) {
      const nextAttemptCount = job.attempts + 1
      const willRetry = nextAttemptCount < MAX_JOB_ATTEMPTS

      jobLogger.error(
        { err: error },
        `Job failed on attempt ${nextAttemptCount}/${maxAttempts}${willRetry ? ' - will retry' : ' - max attempts reached'}`
      )

      const scheduledFor = willRetry
        ? DateTime.now().plus({ seconds: RETRY_DELAYS[nextAttemptCount] })
        : null

      await job
        .useTransaction(trx)
        .merge({
          status: 'failed',
          attempts: nextAttemptCount,
          scheduledFor,
          lastError: error.message || 'Unknown error',
        })
        .save()

      try {
        const payload = job.payload as WebhookJobPayload
        const webhookEvent = await WebhookEvent.find(payload.eventId, { client: trx })
        if (webhookEvent) {
          await webhookEvent
            .useTransaction(trx)
            .merge({
              status: 'failed',
              attempts: nextAttemptCount,
              lastError: error.message,
            })
            .save()
        }
      } catch (webhookUpdateError) {
        logger.error('Failed to update webhook_event status', {
          error: webhookUpdateError.message,
        })
      }

      if (nextAttemptCount >= maxAttempts) {
        logger.error('Webhook job failed after max attempts', {
          jobId: job.id,
          attempts: nextAttemptCount,
        })
      }
    }
  }

  private async recoverStuckWebhooks(): Promise<void> {
    const stuckThreshold = DateTime.now().minus({ minutes: 5 })

    const stuckWebhooks = await WebhookEvent.query()
      .where('status', 'processing')
      .where('updated_at', '<', stuckThreshold.toSQL())

    if (stuckWebhooks.length > 0) {
      logger.warn('Recovering stuck webhooks', {
        count: stuckWebhooks.length,
      })

      for (const webhook of stuckWebhooks) {
        await webhook
          .merge({ status: 'pending', lastError: 'Recovered from stuck processing state' })
          .save()
      }
    }
  }
}
