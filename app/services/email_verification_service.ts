import User from '#models/user'
import stringHelpers from '@adonisjs/core/helpers/string'
import hash from '@adonisjs/core/services/hash'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import env from '#start/env'
import EmailVerification from '#models/email_verifications_token'

export default class EmailVerificationService {
  private readonly TOKEN_EXPIRY_MINUTES = 20

  private async deleteExistingToken(email: string): Promise<void> {
    await EmailVerification.query().where('email', email).delete()
  }

  private async generateResetToken(email: string): Promise<string> {
    await this.deleteExistingToken(email)

    const plainToken = stringHelpers.generateRandom(64)
    const hashedToken = await hash.make(plainToken)

    await EmailVerification.create({
      email,
      token: hashedToken,
      expiresAt: DateTime.now().plus({ minutes: this.TOKEN_EXPIRY_MINUTES }),
    })

    return plainToken
  }
}
