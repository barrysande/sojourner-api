import PasswordResetToken from '#models/password_reset_token'
import stringHelpers from '@adonisjs/core/helpers/string'
import hash from '@adonisjs/core/services/hash'
import { DateTime } from 'luxon'

export default class PasswordResetService {
  async generateToken(email: string) {
    await PasswordResetToken.query().where('email', email).delete()

    const plainToken = stringHelpers.generateRandom(64)
    const hashedToken = await hash.make(plainToken)

    const resetToken = await PasswordResetToken.create({
      email,
      token: hashedToken,
      expiresAt: DateTime.now().plus({ hours: 1 }),
    })

    resetToken.$extras.plainToken = plainToken
    return resetToken
  }

  async verifyToken(email: string, token: string) {
    const resetToken = await PasswordResetToken.query()
      .where('email', email)
      .where('expires_at', '>', DateTime.now().toSQL())
      .whereNull('used_at')
      .first()

    if (!resetToken) {
      return null
    }

    const isValid = await hash.verify(resetToken.token, token)
    if (!isValid) {
      return null
    }

    return resetToken
  }

  async MarkAsUsed(resetToken: PasswordResetToken) {
    resetToken.usedAt = DateTime.now()
    await resetToken.save()
  }
}
