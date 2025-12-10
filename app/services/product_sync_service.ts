import Plan from '#models/plan'
import db from '@adonisjs/lucid/services/db'
import type { DodoProductWithDetails } from '../../types/payments.js'
import DodoPaymentService from './dodo_payment_service.js'
import { inject } from '@adonisjs/core'

@inject()
export default class ProductSyncService {
  private static cachedPlans: Plan[] | null = null
  private static cacheTimestamp: number = 0
  private static readonly CACHE_TTL = 1000 * 60 * 60

  constructor(protected dodopaymentService: DodoPaymentService) {}

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^\w ]+/g, '')
      .replace(/ +/g, '-')
  }

  async sync(): Promise<{ message: string; plans: Plan[] }> {
    const dodoProducts: DodoProductWithDetails[] = []

    for await (const product of this.dodopaymentService.client.products.list()) {
      const details = await this.dodopaymentService.client.products.retrieve(product.product_id)
      dodoProducts.push(details as DodoProductWithDetails)
    }

    const { plans, count } = await db.transaction(async (trx) => {
      await Plan.query({ client: trx }).delete()

      const plansToCreate = dodoProducts.map((p) => {
        return {
          productId: p.product_id,
          name: p.name,
          slug: this.generateSlug(p.name),
          price: p.price.price,
          addonId: p.addons?.[0] ?? null,
        }
      })

      let syncedPlans: Plan[] = []
      if (plansToCreate.length > 0) {
        syncedPlans = await Plan.createMany(plansToCreate, { client: trx })
      }

      return {
        plans: syncedPlans,
        count: plansToCreate.length,
      }
    })

    // Clear cache after sync
    ProductSyncService.clearCache()

    return {
      message: `Successfully synced ${count} products.`,
      plans,
    }
  }

  async showProducts(): Promise<Plan[]> {
    const now = Date.now()

    // Return cached plans if still valid
    if (
      ProductSyncService.cachedPlans &&
      now - ProductSyncService.cacheTimestamp < ProductSyncService.CACHE_TTL
    ) {
      return ProductSyncService.cachedPlans
    }

    // Fetch from DB and cache
    ProductSyncService.cachedPlans = await Plan.query().orderBy('price', 'asc')
    ProductSyncService.cacheTimestamp = now

    return ProductSyncService.cachedPlans
  }

  static clearCache(): void {
    ProductSyncService.cachedPlans = null
    ProductSyncService.cacheTimestamp = 0
  }
}
