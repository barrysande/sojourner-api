import PasswordResetToken from '#models/password_reset_token'
import User from '#models/user'
import stringHelpers from '@adonisjs/core/helpers/string'
import hash from '@adonisjs/core/services/hash'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import env from '#start/env'
import mail from '@adonisjs/mail/services/main'
import PasswordResetMail from '#mails/password_reset_mail'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'
import InvalidTokenException from '#exceptions/invalid_token_exception'

export default class PasswordResetService {
  private readonly TOKEN_EXPIRY_HOUR = 1

  private async deleteExistingToken(email: string, trx: TransactionClientContract): Promise<void> {
    await PasswordResetToken.query({ client: trx }).where('email', email).delete()
  }

  private async generateResetToken(email: string, trx: TransactionClientContract): Promise<string> {
    await this.deleteExistingToken(email, trx)

    const plainToken = stringHelpers.generateRandom(64)
    const hashedToken = await hash.make(plainToken)

    await PasswordResetToken.create(
      {
        email,
        token: hashedToken,
        expiresAt: DateTime.now().plus({ hour: this.TOKEN_EXPIRY_HOUR }),
      },
      { client: trx }
    )

    return plainToken
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await User.findBy('email', email)

    if (!user) {
      logger.warn('Password reset request for non-existent email', { email })
      return
    }

    try {
      await db.transaction(async (trx) => {
        const plainToken = await this.generateResetToken(email, trx)

        await Job.create(
          {
            queueName: 'emails',
            status: 'pending',
            attempts: 0,
            priority: 5,
            payload: {
              userId: user.id,
              emailType: 'password_reset',
              metadata: {
                plainToken: plainToken,
              },
            },
          },
          { client: trx }
        )
      })
    } catch (error) {
      logger.error('Failed to request password reset', { email, error })
      throw error
    }
  }

  private buildResetUrl(email: string, token: string): string {
    const frontendUrl = env.get('FRONTEND_URL')
    const params = new URLSearchParams({
      email,
      token,
    })

    return `${frontendUrl}/auth/reset-password?${params.toString()}`
  }

  async sendResetEmail(userId: number, plainToken: string): Promise<void> {
    const user = await User.findOrFail(userId)

    if (!user) {
      logger.warn('Password reset request for non-existent email', { userId })
      return
    }

    const resetUrl = this.buildResetUrl(user.email, plainToken)

    await mail.send(new PasswordResetMail(user, resetUrl))

    logger.info(`Password reset email sent to: ${user.email}`)
  }

  async resetPassword(email: string, token: string, newPassword: string): Promise<boolean> {
    try {
      const success = await db.transaction(async (trx) => {
        const user = await User.query({ client: trx })
          .where('email', email)
          .forUpdate()
          .firstOrFail()

        const resetToken = await PasswordResetToken.query({ client: trx })
          .where('email', email)
          .where('expires_at', '>', DateTime.now().toSQL())
          .whereNull('used_at')
          .forUpdate()
          .first()

        if (!resetToken) {
          throw new InvalidTokenException('Invalid or expired token')
        }

        const isValid = await hash.verify(resetToken.token, token)
        if (!isValid) {
          throw new InvalidTokenException('Invalid or expired token')
        }

        await user.merge({ password: newPassword }).save()

        await resetToken.merge({ usedAt: DateTime.now() }).save()

        return true
      })

      if (success) {
        logger.info('Password reset successful', { email })
      }
      return success
    } catch (error) {
      logger.error('Password reset failed', { email, err: error })
      return false
    }
  }

  // Clean up used tokens - command method to clean up used tokens. Can be scheduled.
  async cleanupExpiredTokens(): Promise<number> {
    const result = await PasswordResetToken.query()
      .where('expires_at', '<', DateTime.now().toSQL())
      .orWhereNotNull('used_at')
      .delete()

    const deletedCount = result[0].$extras?.affected || 0

    logger.info('Cleaned up expired password reset tokens', {
      count: deletedCount,
    })

    return deletedCount
  }
}
