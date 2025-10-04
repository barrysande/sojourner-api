import type { HttpContext } from '@adonisjs/core/http'
import type { Socket } from 'socket.io'

export interface ExtendedSocket extends Socket {
  context: HttpContext
}
