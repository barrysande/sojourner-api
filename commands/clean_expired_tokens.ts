import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import EmailVerificationService from '#services/email_verification_service'

export default class CleanExpiredTokens extends BaseCommand {
  static commandName = 'clean:expired-tokens'
  static description = 'Clean expired email verification details'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    const emailVerificationService = await this.app.container.make(EmailVerificationService)

    const deletedCount = await emailVerificationService.cleanupExpiredTokens()

    this.logger.info(`Deleted ${deletedCount} expired email verification details`)
  }
}
