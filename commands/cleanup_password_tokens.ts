import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import PasswordResetService from '#services/password_reset_service'

export default class CleanupPasswordTokens extends BaseCommand {
  static commandName = 'cleanup:password-tokens'
  static description = 'Clean up expired password reset tokens'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    const passwordResetService = new PasswordResetService()

    const deletedCount = await passwordResetService.cleanupExpiredTokens()
    this.logger.info(`Deleted ${deletedCount} expired password reset tokens`)
  }
}
