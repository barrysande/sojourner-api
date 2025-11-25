import type { HttpContext } from '@adonisjs/core/http'
import SocialAuthentication from '#models/social_authentication'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { DateTime } from 'luxon'

export default class SocialAuthsController {
  async redirect({ ally }: HttpContext) {
    return ally.use('google').redirect()
  }

  async handleCallback({ ally, auth, response }: HttpContext) {
    const google = ally.use('google')
    const frontendDashboard = env.get('FRONTEND_URL') + '/dashboard'

    if (google.accessDenied()) {
      // User cancelled the login
      return response.redirect(`${frontendDashboard}?error=auth_cancelled`)
    }
    if (google.stateMisMatch()) {
      // CSRF attack or expired state
      return response.redirect(`${frontendDashboard}?error=invalid_state`)
    }
    if (google.hasError()) {
      // Any other error from Google
      return response.redirect(`${frontendDashboard}?error=${google.getError() || 'unknown'}`)
    }

    const googleUser = await google.user()

    const socialAuth = await SocialAuthentication.query()
      .where('provider_name', 'google')
      .where('provider_id', googleUser.id)
      .preload('user')
      .first()

    if (socialAuth) {
      await auth.use('web').login(socialAuth.user)
      return response.redirect(frontendDashboard)
    }

    try {
      const user = await db.transaction(async (trx) => {
        let userToLogin: User
        const existingUser = await User.query({ client: trx })
          .where('email', googleUser.email)
          .first()

        if (existingUser) {
          userToLogin = existingUser
          if (!userToLogin.avatarUrl && googleUser.avatarUrl) {
            userToLogin.avatarUrl = googleUser.avatarUrl
          }
        } else {
          userToLogin = await User.create(
            {
              fullName: googleUser.name || googleUser.nickName,
              email: googleUser.email,
              password: null,
              avatarUrl: googleUser.avatarUrl,
              emailVerifiedAt:
                googleUser.emailVerificationState === 'verified' ? DateTime.now() : null,
            },
            { client: trx }
          )
        }

        await SocialAuthentication.create(
          {
            userId: userToLogin.id,
            providerName: 'google',
            providerId: googleUser.id,
            email: googleUser.email,
            avatarUrl: googleUser.avatarUrl,
          },
          { client: trx }
        )

        if (userToLogin.isDirty()) {
          await userToLogin.useTransaction(trx).save()
        }

        return userToLogin
      })
      await auth.use('web').login(user)
      return response.redirect(frontendDashboard)
    } catch (error) {
      return response.status(500).redirect(`${frontendDashboard}?error=account_creation_failed`)
    }
  }
}
