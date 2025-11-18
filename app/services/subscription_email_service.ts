import User from '#models/user'
import mail from '@adonisjs/mail/services/main'
import logger from '@adonisjs/core/services/logger'
import SubscriptionConfirmationMail from '#mails/subscription_confirmation_mail'

export default class SubscriptionEmailService {
  public async sendSubscriptionConfirmation(userId: number, metadata: Record<string, any>) {
    try {
      const user = await User.findOrFail(userId)

      await mail.send(new SubscriptionConfirmationMail(user, metadata))

      logger.info('Subscription confirmation email sent', {
        userId: user.id,
        email: user.email,
      })
    } catch (error) {
      logger.error('Failed to send subscription confirmation', {
        userId,
        error,
      })
      // Throwing the error here so that the job worker can catch it and mark the job as 'failed'.
      throw error
    }
  }
}
