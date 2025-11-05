import app from '@adonisjs/core/services/app'
import { Server, ServerOptions } from 'socket.io'

class Websocket {
  private booted = false

  io!: Server

  async boot() {
    if (this.booted) {
      return
    }

    this.booted = true

    const adonisServer = await app.container.make('server')
    const socketConfig = app.config.get<ServerOptions>('socket')

    this.io = new Server(adonisServer.getNodeServer(), socketConfig)
  }

  async shutdown() {
    if (this.booted && this.io) {
      await this.io.close()
      this.booted = false
    }
  }
}

export type SocketMiddleware = Parameters<Websocket['io']['use']>[0]

export default new Websocket()
