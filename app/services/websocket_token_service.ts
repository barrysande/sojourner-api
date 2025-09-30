import { jwtVerify, SignJWT } from 'jose'
import { inject } from '@adonisjs/core'
import env from '#start/env'

@inject()
export class WebsocketTokenService {
  private secret: Uint8Array
  constructor() {
    this.secret = new TextEncoder().encode(env.get('JWT_SECRET'))
  }

  async generateToken(userId: number): Promise<string> {
    return await new SignJWT({ userId, type: 'websocket' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .setIssuedAt()
      .sign(this.secret)
  }

  async verifyToken(token: string): Promise<{ userId: number } | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret)

      if (payload.type !== 'websocket') {
        return null
      }

      return { userId: payload.userId as number }
    } catch {
      return null
    }
  }
}
