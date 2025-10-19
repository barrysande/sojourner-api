import type { ApplicationService } from '@adonisjs/core/types'
import socket from '#services/socket'
import logger from '@adonisjs/core/services/logger'

export default class SocketProvider {
  constructor(protected app: ApplicationService) {}

  async start() {
    await socket.boot()

    const { setupWebsocketsHandlers } = await import('#services/websocket_service')
    setupWebsocketsHandlers(socket.io)
    logger.info('Socket.io server started')
  }

  // async shutdown() {
  //   if (socket.io) {
  //     socket.io.close()
  //     logger.info('Socket.io server stopped')
  //   }
  // }
}
