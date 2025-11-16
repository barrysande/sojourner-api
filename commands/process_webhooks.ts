import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import WebhookEvent from '#models/webhook_event'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import env from '#start/env'
import app from '@adonisjs/core/services/app'
import Job, { WebhookJobPayload } from '#models/job'
import WebhookService from '#services/webhook_processor_service'

export default class ProcessWebhooks extends BaseCommand {
  static commandName = 'process:webhooks'
  static description = 'Process pending webhook events from the queue'

  static options: CommandOptions = {
    startApp: true,
    allowUnknownFlags: false,
    staysAlive: true,
  }

  private isShuttingDown = false

  async run() {
    const workerSleepInterval = env.get('WEBHOOK_WORKER_INTERVAL', 5000)

    const maxAttempts = env.get('WEBHOOK_MAX_ATTEMPTS', 3)

    logger.info('Webhook worker started', {
      workerSleepInterval,
      maxAttempts,
    })

    this.setupGracefulShutdown()

    while (!this.isShuttingDown) {
      try {
        // try to recover stuck webhooks then process new pending
        await this.recoverStuckWebhooks()

        const pendingJob = await Job.query()
          .where('queue_name', 'webhooks')
          .where('status', 'pending')
          .orderBy('priority', 'asc')
          .orderBy('created_at', 'asc')
          .limit(1)
          .forUpdate()
          .skipLocked()

        if (pendingJob.length === 0) {
          return
        }

        await this.processJob(pendingJob[0], maxAttempts)

        await this.sleep(workerSleepInterval)
      } catch (error) {
        logger.error('Error in webhook worker loop', {
          error: error.message,
          stack: error.stack,
        })
        // Continue loop even on error so that you don't crash the worker
        await this.sleep(workerSleepInterval)
      }
    }
    this.logger.info('Webhook worker stopped gracefully')
  }

  /**
   * Process a single job. Extracted logic so that the processBatch method's loop only calls it passes
   * @param webhook
   * @param maxAttempts
   */
  private async processJob(job: Job, maxAttempts: number): Promise<void> {
    try {
      await job.merge({ status: 'processing' }).save()

      const payload = job.payload as WebhookJobPayload
      const webhookEvent = await WebhookEvent.findOrFail(payload.eventId)

      const webhookService = await app.container.make(WebhookService)

      const user = await webhookService.processWebhookEvent(webhookEvent)

      await webhookEvent.merge({ status: 'completed', processedAt: DateTime.now() }).save()

      if (user) {
        logger.info('Enqueuing payment receipt for user', { userId: user.id })

        await Job.create({
          queueName: 'emails',
          payload: {
            userId: user.id,
            emailType: 'email_verification',
            metadata: {
              eventName: webhookEvent.eventType,
            },
          },
          status: 'pending',
          priority: 10,
        })
      }

      await job.merge({ status: 'completed' }).save()

      logger.info('Webhook job processed successfully', {
        jobId: job.id,
        eventId: webhookEvent.eventId,
        eventType: webhookEvent.eventType,
        attempts: job.attempts,
      })
    } catch (error) {
      await job
        .merge({ status: 'failed', attempts: (job.attempts += 1), lastError: error.message })
        .save()

      try {
        const payload = job.payload as WebhookJobPayload
        const webhookEvent = await WebhookEvent.find(payload.eventId)
        if (webhookEvent) {
          webhookEvent.status = 'failed'
          webhookEvent.attempts += 1
          webhookEvent.lastError = error.message
          await webhookEvent.save()
        }
      } catch (webhookUpdateError) {
        logger.error('Failed to update webhook_event status', {
          error: webhookUpdateError.message,
        })
      }

      logger.error('Webhook job processing failed', {
        jobId: job.id,
        attempts: job.attempts,
        maxAttempts,
        error: error.message,
        stack: error.stack,
      })

      if (job.attempts >= maxAttempts) {
        logger.error('Webhook job failed after max attempts', {
          jobId: job.id,
          attempts: job.attempts,
        })
        // TODO: Send alert (email, Slack, etc.)
      }
    }
  }

  /**
   * Recover webhooks stuck in 'processing' status
   * These are webhooks that were being processed when worker crashed
   */
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

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) {
        return
      }

      logger.info(`Received ${signal}, shutting down gracefully...`)
      this.isShuttingDown = true

      // Wait for current batch to finish (max 30 seconds)
      const maxWait = 30000
      const startTime = Date.now()

      while (Date.now() - startTime < maxWait) {
        // Check if any webhooks are being processed
        const processingCount = await WebhookEvent.query()
          .where('status', 'processing')
          .count('*', 'total')

        if (Number(processingCount[0].$extras.total) === 0) {
          break
        }

        await this.sleep(1000)
      }

      process.exit(0)
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
  }
}
