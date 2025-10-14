import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import {
  loginValidator,
  registerValidator,
  changePasswordValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
} from '#validators/auth'
import { errors as authErrors } from '@adonisjs/auth'
import hash from '@adonisjs/core/services/hash'
import logger from '@adonisjs/core/services/logger'
import PasswordResetService from '#services/password_reset_service'
import { inject } from '@adonisjs/core'

@inject()
export default class AuthController {
  constructor(private passwordResetService: PasswordResetService) {}
  async register({ request, response }: HttpContext) {
    try {
      const data = await request.validateUsing(registerValidator)

      const user = await User.create(data)

      return response.created({
        message: 'User created successfully',
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
          errors: error.messages,
        })
      }

      // Database constraint errors (unique email) - Avoids race condition of manually checking the user using User.findBy('email', data.email) then creating a user.
      if (error.code === '23505') {
        return response.conflict({
          message: 'User with this email already exists',
        })
      }

      logger.error('Registration error:', error)

      return response.internalServerError({
        message: 'An error occurred during registration',
      })
    }
  }

  async login({ request, response, auth }: HttpContext) {
    try {
      const { email, password, rememberMe } = await request.validateUsing(loginValidator)

      // login user
      const user = await User.verifyCredentials(email, password)
      await auth.use('web').login(user, !!rememberMe)

      return response.ok({
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
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
          createdAt: user.createdAt,
        },
      })
    } catch (error) {
      // User not authenticated
      if (error instanceof authErrors.E_UNAUTHORIZED_ACCESS) {
        return response.unauthorized({
          message: 'Authentication required',
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

      // 1. Verify current password using AdonisJS auth method 2. Update password
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
    // 1. send password reset token if email provided is associated to a user
    try {
      const { email } = await request.validateUsing(forgotPasswordValidator)
      await this.passwordResetService.sendResetEmail(email)

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
      logger.error('Password reset error:', error)

      return response.internalServerError({
        message: 'Unable to reset password',
      })
    }
  }
}
