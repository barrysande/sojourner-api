import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { loginValidator, registerValidator } from '#validators/auth'
import { errors as authErrors } from '@adonisjs/auth'
import hash from '@adonisjs/core/services/hash'
import vine from '@vinejs/vine'

export default class AuthController {
  async register({ request, response }: HttpContext) {
    try {
      const data = await request.validateUsing(registerValidator)

      // Check if user already exists
      const existingUser = await User.findBy('email', data.email)
      if (existingUser) {
        return response.conflict({
          message: 'User with this email already exists',
          errors: { email: ['Email already taken'] },
        })
      }

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
      // Validation errors are automatically handled by AdonisJS
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
          errors: error.messages,
        })
      }

      // Database constraint errors (unique email, etc.)
      if (error.code === '23505') {
        // PostgreSQL unique violation
        return response.conflict({
          message: 'User with this email already exists',
        })
      }

      // Log the error for debugging
      console.error('Registration error:', error)

      return response.internalServerError({
        message: 'An error occurred during registration',
      })
    }
  }

  async login({ request, response, auth }: HttpContext) {
    try {
      const { email, password } = await request.validateUsing(loginValidator)

      const user = await User.verifyCredentials(email, password)
      await auth.use('web').login(user)

      return response.ok({
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
        },
      })
    } catch (error) {
      // Invalid credentials
      if (error instanceof authErrors.E_INVALID_CREDENTIALS) {
        return response.badRequest({
          message: 'Invalid email or password',
          errors: { credentials: ['Invalid email or password'] },
        })
      }

      // Validation errors
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
          errors: error.messages,
        })
      }

      // User not found or other auth errors
      if (error.message?.includes('Unable to verify user credentials')) {
        return response.badRequest({
          message: 'Invalid email or password',
        })
      }

      console.error('Login error:', error)

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
      console.error('Logout error:', error)

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

      console.error('Me endpoint error:', error)

      return response.internalServerError({
        message: 'An error occurred while fetching user data',
      })
    }
  }

  // Changing password
  async changePassword({ request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      // Create validator for change password
      const changePasswordValidator = vine.compile(
        vine.object({
          currentPassword: vine.string(),
          newPassword: vine.string().minLength(8),
        })
      )

      const { currentPassword, newPassword } = await request.validateUsing(changePasswordValidator)

      // Verify current password using AdonisJS auth method
      const isValidPassword = await hash.verify(user.password, currentPassword)
      if (!isValidPassword) {
        return response.badRequest({
          message: 'Current password is incorrect',
        })
      }

      // Update password
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

      console.error('Change password error:', error)

      return response.internalServerError({
        message: 'An error occurred while changing password',
      })
    }
  }
}
