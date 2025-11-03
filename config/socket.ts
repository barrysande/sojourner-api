import type { ServerOptions } from 'socket.io'
import { HttpContext } from '@adonisjs/core/http'

const socketIoConfig: Partial<ServerOptions> = {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST'],
  },

  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
}

export default socketIoConfig

declare module 'socket.io' {
  interface Socket {
    context: HttpContext
  }
}
