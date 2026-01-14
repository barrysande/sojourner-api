import User from '#models/user'
import stringHelpers from '@adonisjs/core/helpers/string'
import hash from '@adonisjs/core/services/hash'
import { DateTime } from 'luxon'
import EmailVerificationToken from '#models/email_verification_token'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import NotFoundException from '#exceptions/not_found_exception'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import EmailVerificationMail from '#mails/email_verification_mail'
import mail from '@adonisjs/mail/services/main'
import InvalidTokenException from '#exceptions/invalid_token_exception'
import db from '@adonisjs/lucid/services/db'
import { Exception } from '@adonisjs/core/exceptions'
import Job from '#models/job'

export default class EmailVerificationService {
  private RESEND_WAIT_SECONDS = 3600

  private async deleteExistingToken(userId: number, trx: TransactionClientContract): Promise<void> {
    await EmailVerificationToken.query({ client: trx }).where('user_id', userId).delete()
  }

  async generateVerificationToken(
    userId: number,
    trx: TransactionClientContract
  ): Promise<{ plainToken: string; hashedToken: string }> {
    await this.deleteExistingToken(userId, trx)

    const plainToken = stringHelpers.generateRandom(64)

    const hashedToken = await hash.make(plainToken)

    await EmailVerificationToken.create(
      {
        userId,
        tokenHash: hashedToken,
        type: 'email_verification',
        expiresAt: DateTime.now().plus({ hour: 1 }),
      },
      { client: trx }
    )
    logger.info('Email verification token created successfully')

    return { plainToken, hashedToken }
  }

  private buildVerificationUrl(email: string, token: string): string {
    const frontendUrl = env.get('FRONTEND_URL')
    const params = new URLSearchParams({
      email,
      token,
    })

    return `${frontendUrl}/auth/verify-email?${params.toString()}`
  }

  async sendVerificationEmail(userId: number, plainToken: string): Promise<void> {
    try {
      const user = await User.findOrFail(userId)

      const emailVerificationUrl = this.buildVerificationUrl(user.email, plainToken)

      await mail.sendLater(new EmailVerificationMail(user, emailVerificationUrl))

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

  async cleanupExpiredTokens(): Promise<number> {
    const result = await EmailVerificationToken.query()
      .where('expires_at', '<', DateTime.now().toSQL())
      .orWhereNotNull('used_at')
      .delete()

    const deletedCount = Number(result[0].$extras)

    logger.info('Cleaned up e xpired password reset tokens', {
      count: deletedCount,
    })

    return deletedCount
  }

  async resendVerificationEmail(userId: number): Promise<void> {
    const existingToken = await EmailVerificationToken.query()
      .where('user_id', userId)
      .orderBy('created_at', 'desc')
      .first()

    if (existingToken) {
      const secondsSinceLast = Math.abs(existingToken.createdAt.diffNow('seconds').seconds)

      if (secondsSinceLast < this.RESEND_WAIT_SECONDS) {
        throw new Exception('Check email or try later.', {
          status: 429,
          code: 'E_TOO_MANY_REQUESTS',
        })
      }
    }

    await db.transaction(async (trx) => {
      const { plainToken } = await this.generateVerificationToken(userId, trx)

      await Job.create(
        {
          queueName: 'emails',
          payload: {
            userId: userId,
            emailType: 'email_verification',
            metadata: { plainToken: plainToken },
          },
          status: 'pending',
          priority: 3,
          attempts: 0,
        },
        { client: trx }
      )
    })
  }
}
