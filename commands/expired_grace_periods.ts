import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import GracePeriodService from '#services/grace_period_service'
import app from '@adonisjs/core/services/app'

export default class ExpiredGracePeriods extends BaseCommand {
  static commandName = 'expired:grace-periods'
  static description =
    'Check for expired grace periods, degrade the users to free tier, and send notifications'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    const gracePeriodService = await app.container.make(GracePeriodService)

    const degradedCount = await gracePeriodService.checkExpiredGracePeriods()
    this.logger.info(`Degraded ${degradedCount} users to free tier`)
  }
}
