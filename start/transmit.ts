import transmit from '@adonisjs/transmit/services/main'
import type { HttpContext } from '@adonisjs/core/http'

transmit.authorize<{ id: string }>('users/:id/notifications', (ctx: HttpContext, { id }) => {
  if (!ctx.auth.user || ctx.auth.user.id !== Number(id)) {
    return false
  }

  return true
})
