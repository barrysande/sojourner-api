import type { HttpContext } from '@adonisjs/core/http'
import Plan from '#models/plan'

export default class PlansController {
  async index({ response }: HttpContext) {
    const plans = await Plan.query().select('productId', 'slug', 'name')

    return response.ok({ plans })
  }
}
