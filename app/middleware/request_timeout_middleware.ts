import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class RequestTimeoutMiddleware {
  async handle(ctx: HttpContext, next: NextFn, options: { timeout?: number } = {}) {
    const timeout = options.timeout || 30000

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Request timeout'))
      }, timeout)
    })

    try {
      Promise.race([next(), timeoutPromise])
    } catch (error) {
      if (error.message === 'Request timeout') {
        return ctx.response.status(408).json({
          message: 'Request timeout - please try again',
        })
      }
      throw error
    }
  }
}
