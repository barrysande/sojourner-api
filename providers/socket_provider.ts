import type { ApplicationService } from '@adonisjs/core/types'
import { Server } from 'socket.io'

export default class SocketProvider {
  constructor(protected app: ApplicationService) {}

  private io: Server | null = null

  /**
   * Register bindings to the container
   */
  register() {
    // Not async!
    this.app.container.singleton('socket.io', () => this.io)
  }

  /**
   * The container bindings have booted
   */
  async boot() {}

  /**
   * The application has been booted
   */
  async start() {
    const adonisHttpServer = await this.app.container.make('server')

    // Access the underlying Node.js server
    this.io = new Server(adonisHttpServer.getNodeServer(), {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
    })

    // Setup WebSocket handlers
    const { setupWebSocketHandlers } = await import('#services/websocket_service')
    setupWebSocketHandlers(this.io)

    console.log('Socket.IO server started')
  }

  /**
   * The process has been started
   */
  async ready() {}

  /**
   * Preparing to shutdown the app
   */
  async shutdown() {
    if (this.io) {
      this.io.close()
      console.log('Socket.IO server stopped')
    }
  }
}
