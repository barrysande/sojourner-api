import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { loginValidator, registerValidator, changePasswordValidator } from '#validators/auth'
import { errors as authErrors } from '@adonisjs/auth'
import hash from '@adonisjs/core/services/hash'
import logger from '@adonisjs/core/services/logger'
import limiter from '@adonisjs/limiter/services/main'

// login limiter
const loginLimiter = limiter.use({
  requests: 5,
  duration: '1 min',
  blockDuration: '20 mins',
})

export default class AuthController {
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
      // Validation errors are automatically handled by AdonisJS Error Handler
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

      // Log the error for debugging
      logger.error('Registration error:', error)

      return response.internalServerError({
        message: 'An error occurred during registration',
      })
    }
  }

  async login({ request, response, auth }: HttpContext) {
    try {
      const { email, password } = await request.validateUsing(loginValidator)

      // construct key to pass to the limiter config instance - loginLimiter

      const key = `login_${request.ip()}_${email.toLowerCase().trim()}`

      const [error, user] = await loginLimiter.penalize(key, () => {
        return User.verifyCredentials(email, password)
      })

      if (error) {
        response.header('X-RateLimit-Limit', '5')
        response.header('X-RateLimit-Remaining', '0')
        response.header('Retry-After', error.response.availableIn.toString())
        return response.tooManyRequests({
          message: 'Too many login attempts',
          error: {
            type: 'E_TOO_MANY_REQUESTS',
            retryAfter: error.response.availableIn,
          },
        })
      }

      // login user
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

  // Changing password
  async changePassword({ request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

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

      logger.error('Change password error:', error)

      return response.internalServerError({
        message: 'An error occurred while changing password',
      })
    }
  }
}
