import { ServerResponse } from 'node:http'
import app from '@adonisjs/core/services/app'
import type { SocketMiddleware } from '#services/socket'

const SocketHttpContextMiddleware: SocketMiddleware = async (socket, next) => {
  try {
    const server = await app.container.make('server')
    const response = new ServerResponse(socket.request)

    const request = server.createRequest(socket.request, response)
    const httpResonse = server.createResponse(socket.request, response)
    const resolver = app.container.createResolver()

    const context = server.createHttpContext(request, httpResonse, resolver)

    const authManager = await app.container.make('auth.manager')
    context.auth = authManager.createAuthenticator(context)

    socket.context = context
    next()
  } catch (error) {
    next(new Error('Failed to create HTTP context'))
  }
}

export default SocketHttpContextMiddleware
