import { ServerResponse } from 'node:http'
import app from '@adonisjs/core/services/app'
import type { SocketMiddleware } from '#services/socket'
import SessionMiddleware from '@adonisjs/session/session_middleware'

const SocketHttpContextMiddleware: SocketMiddleware = async (socket, next) => {
  try {
    const server = await app.container.make('server')

    // Create Node.js Request/Response objects
    const response = new ServerResponse(socket.request)
    const request = server.createRequest(socket.request, response)
    const httpResponse = server.createResponse(socket.request, response)
    const resolver = app.container.createResolver()

    // Create the HttpContext
    const context = server.createHttpContext(request, httpResponse, resolver)

    // Execute Session Middleware to decrypt cookies
    const sessionMiddleware = await app.container.make(SessionMiddleware)
    await sessionMiddleware.handle(context, async () => {
      // Initialize Auth (dependent on Session)
      const authManager = await app.container.make('auth.manager')
      context.auth = authManager.createAuthenticator(context)

      // Attach context to socket
      socket.context = context
      next()
    })
  } catch (error) {
    next(new Error('Failed to create HTTP context'))
  }
}

export default SocketHttpContextMiddleware
