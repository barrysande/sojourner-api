import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import WebhookEvent from '#models/webhook_event'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import env from '#start/env'
import app from '@adonisjs/core/services/app'

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
    const batchSize = env.get('WEBHOOK_WORKER_BATCH_SIZE', 10)
    const maxAttempts = env.get('WEBHOOK_MAX_ATTEMPTS', 3)

    logger.info('Webhook worker started', {
      workerSleepInterval,
      batchSize,
      maxAttempts,
    })

    this.setupGracefulShutdown()

    while (!this.isShuttingDown) {
      try {
        // try to recover stuck webhooks then process
        await this.recoverStuckWebhooks()

        await this.processBatch(batchSize, maxAttempts)

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
  }

  /**
   * Process a single webhook. Extracted logic so that the processBatch method's loop only calls it passes
   * @param webhook
   * @param maxAttempts
   */
  private async processWebhook(webhook: WebhookEvent, maxAttempts: number): Promise<void> {
    try {
      await webhook.merge({ status: 'processing' }).save()

      const webhookService = await app.container.make('webhookService')

      await webhookService.processWebhookEvent(webhook)

      await webhook.merge({ status: 'completed', processedAt: DateTime.now() }).save()

      logger.info('Webhook processed successfully', {
        eventId: webhook.eventId,
        eventType: webhook.eventType,
        attempts: webhook.attempts,
      })
    } catch (error) {
      await webhook
        .merge({ status: 'failed', attempts: webhook.attempts + 1, lastError: error.message })
        .save()

      logger.error('Webhook processing failed', {
        eventId: webhook.eventId,
        eventType: webhook.eventType,
        attempts: webhook.attempts,
        maxAttempts,
        error: error.message,
        stack: error.stack,
      })

      if (webhook.attempts >= maxAttempts) {
        logger.error('Webhook failed after max attempts - ALERT', {
          eventId: webhook.eventId,
          eventType: webhook.eventType,
          attempts: webhook.attempts,
        })

        // TODO: send alert email or slack message to admin.
      }
    }
  }

  /**
   * Process a batch of pending webhooks. Calls the processWebhook method
   */
  private async processBatch(batchSize: number, maxAttempts: number): Promise<void> {
    const pendingWebhooks = await WebhookEvent.query()
      .where('status', 'pending')
      .orderBy('created_at', 'asc')
      .limit(batchSize)
      .forUpdate()
      .skipLocked()

    if (pendingWebhooks.length === 0) {
      return
    }

    logger.info('Processing webhook batch', { count: pendingWebhooks.length })

    for (const webhook of pendingWebhooks) {
      await this.processWebhook(webhook, maxAttempts)
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
