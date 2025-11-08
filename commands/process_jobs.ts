import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import Job from '#models/job'
import { EmailJobPayload } from '#models/job'
import logger from '@adonisjs/core/services/logger'
import EmailVerificationService from '#services/email_verification_service'
import { inject } from '@adonisjs/core'

export default class ProcessJobs extends BaseCommand {
  static commandName = 'process:jobs'
  static description = 'Process email and webhook jobs from jobs table'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: false,
    allowUnknownFlags: false,
  }

  @inject()
  protected emailVerificationService!: EmailVerificationService

  async run() {
    this.logger.info('Email processing ongoing...')

    const job = await Job.query()
      .where('status', 'pending')
      .where('queue_name', 'emails')
      .orderBy('created_at', 'asc')
      .forUpdate()
      .skipLocked()
      .limit(1)
      .first()

    if (!job) {
      return
    }

    await job.merge({ status: 'processing' }).save()

    const payload = job?.payload as EmailJobPayload

    try {
      if (payload.emailType === 'email_verification') {
        // Keep this as a fix in case I get dependency issues at run time. I can easily switch to manual dependency injection.
        // const emailVerificationService = await this.app.container.make('emailVerificationService')
        await this.emailVerificationService.sendVerificationEmail(
          payload.userId,
          payload.metadata!.plainToken
        )
      }

      await job.merge({ status: 'completed' }).save()
      logger.info(`Job ${job.id} processed successfully`)
    } catch (error) {
      await job.merge({ status: 'failed', attempts: job.attempts + 1 }).save()

      logger.error(`Job ${job.id} failed after ${job.attempts} attempts`, {
        error,
      })
    }
  }
}
