import Plan from '#models/plan'
import db from '@adonisjs/lucid/services/db'
import type { DodoProductWithDetails } from '../../types/payments.js'
import DodoPaymentService from './dodo_payment_service.js'
import { inject } from '@adonisjs/core'

@inject()
export default class ProductSyncService {
  constructor(protected dodopaymentService: DodoPaymentService) {}

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^\w ]+/g, '')
      .replace(/ +/g, '-')
  }

  async sync(): Promise<{ message: string }> {
    const dodoProducts: DodoProductWithDetails[] = []
    for await (const product of this.dodopaymentService.client.products.list()) {
      const details = await this.dodopaymentService.client.products.retrieve(product.product_id)
      dodoProducts.push(details as DodoProductWithDetails)
    }

    const count = await db.transaction(async (trx) => {
      await Plan.query({ client: trx }).delete()

      const plansToCreate = dodoProducts.map((p) => {
        return {
          productId: p.product_id,
          name: p.name,
          slug: this.generateSlug(p.name),
          price: p.price.price / 100,
          addonId: p.addons?.[0] ?? null,
        }
      })

      if (plansToCreate.length > 0) {
        await Plan.createMany(plansToCreate, { client: trx })
      }

      return plansToCreate.length
    })

    return {
      message: `Successfully synced ${count} products.`,
    }
  }
}
