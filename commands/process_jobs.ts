import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import Job from '#models/job'
import { EmailJobPayload } from '#models/job'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'

const MAX_JOB_ATTEMPTS = 3
const RETRY_DELAYS = [0, 60, 300] // seconds: immediate, 1min, 5min

export default class ProcessJobs extends BaseCommand {
  static commandName = 'process:jobs'
  static description = 'Process email and webhook jobs from jobs table'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: false,
    allowUnknownFlags: false,
  }

  async run() {
    this.logger.info('Worker running: checking for jobs...')

    const job = await Job.query()
      .where((query) => {
        query.where('status', 'pending').orWhere((subQuery) => {
          subQuery.where('status', 'failed').where('attempts', '<', MAX_JOB_ATTEMPTS)
        })
      })
      .where((query) => {
        // Only process jobs that are due to run (scheduled time has passed or no schedule)
        query.whereNull('scheduled_for').orWhere('scheduled_for', '<=', DateTime.now().toSQL())
      })
      .where('queue_name', 'emails')
      .orderBy('priority', 'asc')
      .orderBy('scheduled_for', 'asc')
      .orderBy('created_at', 'asc')
      .forUpdate()
      .skipLocked()
      .limit(1)
      .first()

    if (!job) {
      this.logger.info('No pending jobs found.')
      return
    }

    const jobLogger = logger.child({
      jobId: job.id,
      attempt: job.attempts + 1,
      maxAttempts: MAX_JOB_ATTEMPTS,
    })

    jobLogger.info('Processing job')
    await job.merge({ status: 'processing' }).save()

    const payload = job.payload as EmailJobPayload

    try {
      switch (payload.emailType) {
        case 'email_verification':
          const emailService = await this.app.container.make('emailVerificationService')
          jobLogger.info('Sending verification email')
          await emailService.sendVerificationEmail(payload.userId, payload.metadata!.plainToken)
          break

        case 'password_reset':
          const passwordService = await this.app.container.make('passwordResetService')
          jobLogger.info('Sending password reset email')
          await passwordService.sendResetEmail(payload.userId, payload.metadata!.plainToken)
          break

        case 'subscription_confirmation':
          const subscriptionEmailService = await this.app.container.make('subscriptionEmailService')
          jobLogger.info('Sending subscription confirmation email')
          await subscriptionEmailService.sendSubscriptionConfirmation(
            payload.userId,
            payload.metadata!
          )
          break

        default:
          throw new Error(`Unknown emailType: ${payload.emailType}`)
      }

      await job
        .merge({
          status: 'completed',
          lastError: null,
        })
        .save()

      jobLogger.info('Job completed successfully')
    } catch (error) {
      const nextAttemptCount = job.attempts + 1
      const willRetry = nextAttemptCount < MAX_JOB_ATTEMPTS

      jobLogger.error(
        { err: error },
        `Job failed on attempt ${nextAttemptCount}/${MAX_JOB_ATTEMPTS}${willRetry ? ' - will retry' : ' - max attempts reached'}`
      )

      const scheduledFor = willRetry
        ? DateTime.now().plus({ seconds: RETRY_DELAYS[nextAttemptCount] })
        : null

      await job
        .merge({
          status: 'failed',
          attempts: nextAttemptCount,
          scheduledFor,
          lastError: error.message || 'Unknown error',
        })
        .save()
    }
  }
}
