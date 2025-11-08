import User from '#models/user'
import stringHelpers from '@adonisjs/core/helpers/string'
import hash from '@adonisjs/core/services/hash'
import { DateTime } from 'luxon'
import EmailVerificationToken from '#models/email_verifications_token'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import NotFoundException from '#exceptions/not_found_exception'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import EmailVerificationMail from '#mails/email_verification_mail'
import mail from '@adonisjs/mail/services/main'
import InvalidTokenException from '#exceptions/invalid_token_exception'
import db from '@adonisjs/lucid/services/db'

export default class EmailVerificationService {
  private readonly TOKEN_EXPIRY_HOUR = 1

  private async deleteExistingToken(userId: number): Promise<void> {
    await EmailVerificationToken.query().where('user_id', userId).delete()
  }

  async generateVerificationToken(
    userId: number,
    trx: TransactionClientContract
  ): Promise<{ plainToken: string; hashedToken: string }> {
    await this.deleteExistingToken(userId)

    const plainToken = stringHelpers.generateRandom(64)
    const hashedToken = await hash.make(plainToken)

    await EmailVerificationToken.create(
      {
        userId,
        tokenHash: hashedToken,
        expiresAt: DateTime.now().plus({ hour: this.TOKEN_EXPIRY_HOUR }),
      },
      { client: trx }
    )

    return { plainToken, hashedToken }
  }

  private buildVerificationUrl(email: string, token: string): string {
    const frontendUrl = env.get('FRONTEND_URL')
    const params = new URLSearchParams({
      email,
      token,
    })

    return `${frontendUrl}/auth/verify-email/${params.toString()}`
  }

  async sendVerificationEmail(userId: number, plainToken: string): Promise<void> {
    try {
      const user = await User.findOrFail(userId)

      const emailVerificationUrl = this.buildVerificationUrl(user.email, plainToken)

      await mail.sendLater(new EmailVerificationMail(user, emailVerificationUrl)) // should I really use sendLater or just send since I'm using a database-backed queue?

      logger.info('Verification email sent', {
        userId: user.id,
        email: user.email,
      })
    } catch (error) {
      logger.error('Failed to send verification email', {
        userId,
        error,
      })
      if (error.code === 'E_NOT_FOUND') {
        throw new NotFoundException(`User not found.`)
      }
      throw error
    }
  }

  async verifyToken(userId: number, token: string): Promise<User> {
    const verificationToken = await EmailVerificationToken.query()
      .where('user_id', userId)
      .where('expires_at', '>', DateTime.now().toSQL())
      .whereNull('used_at')
      .first()

    if (!verificationToken) {
      throw new NotFoundException(`Not found`)
    }

    const isValid = await hash.verify(verificationToken.tokenHash, token)
    if (!isValid) {
      throw new InvalidTokenException('Invalid or expired token')
    }

    const user = await db.transaction(async (trx) => {
      const userToUpdate = await User.findOrFail(userId, { client: trx })

      const tokenToUpdate = await EmailVerificationToken.query({ client: trx })
        .where('id', verificationToken.id)
        .whereNull('used_at')
        .forUpdate()
        .first()

      if (!tokenToUpdate) {
        throw new InvalidTokenException('Token has already been used')
      }

      await userToUpdate.useTransaction(trx).merge({ emailVerifiedAt: DateTime.now() }).save()

      await tokenToUpdate.useTransaction(trx).merge({ usedAt: DateTime.now() }).save()

      return userToUpdate
    })

    return user
  }

  //TODO: Schedule Clean up used tokens - command method to clean up used tokens.
  async cleanupExpiredTokens(): Promise<number> {
    const result = await EmailVerificationToken.query()
      .where('expires_at', '<', DateTime.now().toSQL())
      .orWhereNotNull('used_at')
      .delete()

    const deletedCount = result[0].$extras?.affected || 0

    logger.info('Cleaned up e xpired password reset tokens', {
      count: deletedCount,
    })

    return deletedCount
  }
}
