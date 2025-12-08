import type { HttpContext } from '@adonisjs/core/http'
import { registerAdminValidator, loginAdminValidator } from '#validators/admin_auth'
import { forgotPasswordValidator, resetPasswordValidator } from '#validators/auth'
import User from '#models/user'
import logger from '@adonisjs/core/services/logger'
import { errors as authErrors } from '@adonisjs/auth'
import PasswordResetService from '#services/password_reset_service'
import { inject } from '@adonisjs/core'

@inject()
export default class AdminAuthsController {
  constructor(protected passwordResetService: PasswordResetService) {}

  async register({ request, response }: HttpContext) {
    try {
      const data = await request.validateUsing(registerAdminValidator)

      const user = await User.create(data)

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

  async login({ auth, request, response }: HttpContext) {
    try {
      const { email, password } = await request.validateUsing(loginAdminValidator)

      const user = await User.verifyCredentials(email, password)

      if (!user.isAdmin) {
        return response.forbidden({ message: 'Unable to take this action.' })
      }

      await auth.use('web').login(user)

      return response.ok({
        message: 'Admin login successful',
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
        },
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
        })
      }

      if (error instanceof authErrors.E_INVALID_CREDENTIALS) {
        return response.badRequest({
          message: 'Invalid email or password',
        })
      }

      if (error instanceof authErrors.E_UNAUTHORIZED_ACCESS) {
        return response.badRequest({
          message: 'You cannot take this action',
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
          isAdmin: user.isAdmin,
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

  // ADMIN CHANGING PASSWORD WHILE LOGGED OUT
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

  // ADMIN RESET PASSWORD USING RESET TOKEN SENT TO EMAIL
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
}
