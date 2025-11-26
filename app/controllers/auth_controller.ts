import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import {
  loginValidator,
  registerValidator,
  changePasswordValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  verifyEmailTokenValidator,
} from '#validators/auth'
import { errors as authErrors } from '@adonisjs/auth'
import hash from '@adonisjs/core/services/hash'
import logger from '@adonisjs/core/services/logger'
import PasswordResetService from '#services/password_reset_service'
import { inject } from '@adonisjs/core'
import EmailVerificationService from '#services/email_verification_service'
import AvatarService from '#services/avatar_service'
import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'
import { DateTime } from 'luxon'

@inject()
export default class AuthController {
  constructor(
    protected passwordResetService: PasswordResetService,
    protected emailVerificationService: EmailVerificationService,
    protected avatarService: AvatarService
  ) {}

  async register({ request, response }: HttpContext) {
    try {
      const data = await request.validateUsing(registerValidator)

      const user = await db.transaction(async (trx) => {
        const newUser = await User.create(data, { client: trx })

        const plainAndHashed = await this.emailVerificationService.generateVerificationToken(
          newUser.id,
          trx
        )

        await Job.create(
          {
            queueName: 'emails',
            payload: {
              userId: newUser.id,
              emailType: 'email_verification',
              metadata: { plainToken: plainAndHashed.plainToken },
            },
            status: 'pending',
            priority: 3,
            attempts: 0,
          },
          { client: trx }
        )

        return newUser
      })

      return response.created({
        message: 'Account created successfully. Please login',
        user: user,
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
          errors: error.messages,
        })
      }

      // Database constraint errors (unique email)
      if (error.code === '23505') {
        return response.conflict({
          message: 'User with this email already exists',
        })
      }

      return response.internalServerError({
        message: 'An error occurred during registration',
      })
    }
  }

  async verifyEmail({ request, response }: HttpContext) {
    try {
      const { email, token } = await request.validateUsing(verifyEmailTokenValidator)

      const user = await User.findByOrFail('email', email)

      await this.emailVerificationService.verifyToken(user.id, token)

      return response.ok({ userEmail: email, message: `Email successfully verified` })
    } catch (error) {
      if (error.code === 'E_INVALID_TOKEN' || error.code === 'E_NOT_FOUND') {
        return response.badRequest({ message: 'This verification link is invalid or has expired.' })
      }

      if (error.code === 'E_ROW_NOT_FOUND') {
        return response.badRequest({ message: 'User not found.' })
      }

      return response.internalServerError({
        message: 'An error occurred during verification.',
      })
    }
  }

  async resendEmailVerification({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()

    if (user && user.emailVerifiedAt) {
      return response.ok({ message: 'This email is already verified.' })
    }

    try {
      await this.emailVerificationService.resendVerificationEmail(user.id)

      return response.ok({ message: 'A new verification link has been sent to your email.' })
    } catch (error) {
      if (error.code === 'E_TOO_MANY_REQUESTS') {
        return response.tooManyRequests({ message: error.message })
      }
      return response.internalServerError({ message: 'An error occurred, please try again.' })
    }
  }

  async login({ request, response, auth }: HttpContext) {
    try {
      const { email, password, rememberMe } = await request.validateUsing(loginValidator)

      const user = await User.verifyCredentials(email, password)
      await auth.use('web').login(user, !!rememberMe)

      return response.ok({
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          verifiedAt: user.emailVerifiedAt,
        },
      })
    } catch (error) {
      if (error instanceof authErrors.E_INVALID_CREDENTIALS) {
        return response.badRequest({
          message: 'Invalid email or password',
          errors: { credentials: ['Invalid email or password'] },
        })
      }

      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
          errors: error.messages,
        })
      }

      if (error.message?.includes('Unable to verify user credentials')) {
        return response.badRequest({
          message: 'Invalid email or password',
        })
      }

      logger.error('Login error:', error)

      return response.internalServerError({
        message: 'An error occurred during login',
      })
    }
  }

  async logout({ auth, response }: HttpContext) {
    try {
      await auth.use('web').logout()
      return response.ok({ message: 'Logout successful' })
    } catch (error) {
      logger.error('Logout error:', error)

      return response.internalServerError({
        message: 'An error occurred during logout',
      })
    }
  }

  async me({ auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      return response.ok({
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          tier: user.tier,
          verifiedAt: user.emailVerifiedAt,
          avatarUrl: user.avatarUrl,
        },
      })
    } catch (error) {
      if (error instanceof authErrors.E_UNAUTHORIZED_ACCESS) {
        return response.unauthorized({
          message: 'Unauthorized access',
        })
      }

      logger.error('Me endpoint error:', error)

      return response.internalServerError({
        message: 'An error occurred while fetching user data',
      })
    }
  }

  // CHANGING PASSWORD WHILE LOGGED-IN
  async changePassword({ request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const { currentPassword, newPassword } = await request.validateUsing(changePasswordValidator)

      if (!user.password) {
        return response.badRequest({
          message: 'This account uses social sign-in and does not have a password.',
        })
      }

      const isValidPassword = await hash.verify(user.password, currentPassword)
      if (!isValidPassword) {
        return response.badRequest({
          message: 'Current password is incorrect',
        })
      }

      user.password = newPassword
      await user.save()

      return response.ok({
        message: 'Password changed successfully',
      })
    } catch (error) {
      if (error instanceof authErrors.E_UNAUTHORIZED_ACCESS) {
        return response.unauthorized({
          message: 'Authentication required',
        })
      }

      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
          errors: error.messages,
        })
      }

      logger.error('Change password error:', error)

      return response.internalServerError({
        message: 'An error occurred while changing password',
      })
    }
  }

  // CHANGING PASSWORD WHILE LOGGED OUT
  async forgotPassword({ request, response }: HttpContext) {
    try {
      const { email } = await request.validateUsing(forgotPasswordValidator)
      await this.passwordResetService.requestPasswordReset(email)
      return response.ok({
        message:
          'If an account exists with this email, you will receive password reset instructions.',
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Invalid email address',
          errors: error.messages,
        })
      }

      logger.error('Forgot password error:', error)

      return response.internalServerError({
        message: 'Unable to process password reset request',
      })
    }
  }

  // RESET PASSWORD USING RESET TOKEN SENT TO EMAIL
  async resetPassword({ request, response }: HttpContext) {
    try {
      const { email, token, password } = await request.validateUsing(resetPasswordValidator)

      const success = await this.passwordResetService.resetPassword(email, token, password)

      if (!success) {
        return response.badRequest({
          message: 'Invalid or expired reset token',
        })
      }

      return response.ok({
        message: 'Password has been reset successfully. You can now login with your new password.',
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
          errors: error.messages,
        })
      }
      logger.error('Password reset error:', { err: error })

      return response.internalServerError({
        message: 'Unable to reset password',
      })
    }
  }

  async updateAvatar({ request, auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const file = request.file('avatar')

    if (!file) {
      return response.badRequest('No avatar file uploaded')
    }

    if (file.hasErrors) {
      return response.badRequest(file.errors[0].message)
    }

    try {
      const newUrl = await this.avatarService.updateAvatar(user, file)

      await user.merge({ avatarUrl: newUrl, updatedAt: DateTime.now() }).save()

      return response.ok({ avatarUrl: newUrl, message: 'Display avatar successfully changed.' })
    } catch (error) {
      return response.badRequest({ message: error.message })
    }
  }
}
