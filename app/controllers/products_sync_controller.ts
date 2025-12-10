import type { HttpContext } from '@adonisjs/core/http'
import ProductSyncService from '#services/product_sync_service'
import { inject } from '@adonisjs/core'

@inject()
export default class ProductsSyncsController {
  constructor(protected productSyncService: ProductSyncService) {}

  async sync({ auth, response }: HttpContext) {
    const admin = auth.getUserOrFail()

    if (!admin.isAdmin) {
      return response.forbidden({ message: 'Unable to take this action.' })
    }

    try {
      const result = await this.productSyncService.sync()

      return response.ok(result)
    } catch (error) {
      return response.internalServerError({
        message: 'Failed to sync products',
        error,
      })
    }
  }

  async index({ auth, response }: HttpContext) {
    auth.getUserOrFail()

    const plans = await this.productSyncService.showProducts()

    return response.ok(plans)
  }
}
