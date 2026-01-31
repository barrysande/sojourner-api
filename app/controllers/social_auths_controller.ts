import type { HttpContext } from '@adonisjs/core/http'
import SocialAuthentication from '#models/social_authentication'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import env from '#start/env'

export default class SocialAuthsController {
  async redirect({ ally }: HttpContext) {
    return ally.use('google').stateless().redirect()
  }

  async handleCallback({ ally, auth, response }: HttpContext) {
    const google = ally.use('google')

    // Always redirect to dashboard (path only)
    const redirectPath = env.get('FRONTEND_URL') + '/dashboard'

    if (google.accessDenied()) {
      return response.redirect(`${redirectPath}?error=auth_cancelled`)
    }

    if (google.stateMisMatch()) {
      return response.redirect(`${redirectPath}?error=invalid_state`)
    }

    if (google.hasError()) {
      return response.redirect(`${redirectPath}?error=${google.getError() || 'unknown'}`)
    }

    const googleUser = await google.user()

    const socialAuth = await SocialAuthentication.query()
      .where('provider_name', 'google')
      .where('provider_id', googleUser.id)
      .preload('user')
      .first()

    if (socialAuth) {
      await auth.use('web').login(socialAuth.user)
      return response.redirect(redirectPath)
    }

    try {
      let user: User | null = null
      const userToLogin = await db.transaction(async (trx) => {
        const existingUser = await User.query({ client: trx })
          .where('email', googleUser.email)
          .first()

        if (existingUser) {
          user = existingUser
          if (!user.avatarUrl && googleUser.avatarUrl) {
            user.avatarUrl = googleUser.avatarUrl
            user.avatarSource = 'social'
            await user.useTransaction(trx).save()
          }
        } else {
          user = await User.create(
            {
              fullName: googleUser.name || googleUser.nickName,
              email: googleUser.email,
              avatarUrl: googleUser.avatarUrl,
              avatarSource: 'social',
              emailVerifiedAt:
                googleUser.emailVerificationState === 'verified' ? DateTime.now() : null,
            },
            { client: trx }
          )
        }

        await SocialAuthentication.create(
          {
            userId: user.id,
            providerName: 'google',
            providerId: googleUser.id,
            email: googleUser.email,
            avatarUrl: googleUser.avatarUrl,
          },
          { client: trx }
        )

        return user
      })

      await auth.use('web').login(userToLogin)

      return response.redirect(redirectPath)
    } catch (error) {
      return response.status(500).redirect(`${redirectPath}?error=account_creation_failed`)
    }
  }
}
