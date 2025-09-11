import PasswordResetToken from '#models/password_reset_token'
import User from '#models/user'
import stringHelpers from '@adonisjs/core/helpers/string'
import hash from '@adonisjs/core/services/hash'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import env from '#start/env'
import mail from '@adonisjs/mail/services/main'
import PasswordResetMail from '#mails/password_reset_mail'

export default class PasswordResetService {
  private readonly TOKEN_EXPIRY_HOURS = 1

  private async deleteExistingToken(email: string): Promise<void> {
    await PasswordResetToken.query().where('email', email).delete()
  }

  private async generateResetToken(email: string): Promise<string> {
    await this.deleteExistingToken(email)

    const plainToken = stringHelpers.generateRandom(64)
    const hashedToken = await hash.make(plainToken)

    await PasswordResetToken.create({
      email,
      token: hashedToken,
      expiresAt: DateTime.now().plus({ hours: this.TOKEN_EXPIRY_HOURS }),
    })

    return plainToken
  }

  private buildResetUrl(email: string, token: string): string {
    const frontendUrl = env.get('FRONTEND_URL')
    const params = new URLSearchParams({
      email,
      token,
    })

    return `${frontendUrl}/reset-password?${params.toString()}`
  }

  async sendResetEmail(email: string): Promise<boolean> {
    const user = await User.findBy('email', email)

    if (!user) {
      logger.info('Password reset request for non-existent email', { email })
      return true
    }

    try {
      const plainToken = await this.generateResetToken(email)

      const resetUrl = this.buildResetUrl(email, plainToken)

      await mail.send(new PasswordResetMail(user, resetUrl))

      logger.info('Password reset email sent', {
        userId: user.id,
        email,
      })

      return true
    } catch (error) {
      logger.error('Failed to send password reset email', {
        email,
        error: error.message,
      })
      throw error
    }
  }

  async verifyToken(email: string, token: string): Promise<boolean> {
    const resetToken = await PasswordResetToken.query()
      .where('email', email)
      .where('expires_at', '>', DateTime.now().toSQL())
      .whereNull('used_at')
      .first()

    if (!resetToken) {
      return false
    }

    const isValid = await hash.verify(resetToken.token, token)
    if (!isValid) {
      return false
    }

    return isValid
  }

  async resetPassword(email: string, token: string, newPassword: string): Promise<boolean> {
    const isVerifiedToken = await this.verifyToken(email, token)

    if (!isVerifiedToken) {
      logger.warn('Invalid password reset attempt', {
        email,
      })
      return false
    }

    const user = await User.findBy('email', email)
    if (!user) {
      return false
    }

    user.password = newPassword
    await user.save()

    await this.markTokenAsUsed(email)
    logger.info('Password reset successful', {
      userId: user.id,
      email,
    })

    return true
  }

  async markTokenAsUsed(email: string): Promise<void> {
    await PasswordResetToken.query()
      .where('email', email)
      .whereNull('used_at')
      .update({ usedAt: DateTime.now() })
  }

  // Clean up used tokens

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
