import type { HttpContext } from '@adonisjs/core/http'
import SocialAuthentication from '#models/social_authentication'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { DateTime } from 'luxon'

export default class SocialAuthsController {
  async redirect({ ally }: HttpContext) {
    return ally.use('google').stateless().redirect()
  }

  async handleCallback({ ally, auth, response }: HttpContext) {
    const google = ally.use('google')
    const frontendRedirect = app.inProduction
      ? `${env.get('FRONTEND_URL')}/dashboard`
      : `${env.get('FRONTEND_URL')}/auth/sso/callback`

    if (google.accessDenied()) {
      // User cancelled the login

      return response.redirect(`${frontendRedirect}?error=auth_cancelled`)
    }
    if (google.stateMisMatch()) {
      // CSRF attack or expired state

      return response.redirect(`${frontendRedirect}?error=invalid_state`)
    }
    if (google.hasError()) {
      // Any other error from Google

      return response.redirect(`${frontendRedirect}?error=${google.getError() || 'unknown'}`)
    }

    const googleUser = await google.user()

    const socialAuth = await SocialAuthentication.query()
      .where('provider_name', 'google')
      .where('provider_id', googleUser.id)
      .preload('user')
      .first()

    if (socialAuth) {
      await auth.use('web').login(socialAuth.user)
      return response.redirect(frontendRedirect)
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
            userToLogin.avatarSource = 'social'
            userToLogin.avatarKey = null
          }
        } else {
          userToLogin = await User.create(
            {
              fullName: googleUser.name || googleUser.nickName,
              email: googleUser.email,
              password: null,
              avatarUrl: googleUser.avatarUrl,
              avatarSource: 'social',
              avatarKey: null,
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
      return response.redirect(frontendRedirect)
    } catch (error) {
      return response.status(500).redirect(`${frontendRedirect}?error=account_creation_failed`)
    }
  }
}
