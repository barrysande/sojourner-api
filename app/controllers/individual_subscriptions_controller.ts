import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import IndividualSubscriptionService from '#services/individual_subscription_service'
import {
  createIndividualSubscriptionValidator,
  changeIndividualPlanValidator,
} from '#validators/subscription'
import Plan from '#models/plan'

@inject()
export default class IndividualSubscriptionsController {
  constructor(protected individualSubscriptionService: IndividualSubscriptionService) {}

  async create({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const payload = await request.validateUsing(createIndividualSubscriptionValidator)

    const plan = await Plan.query().where('slug', payload.slug).firstOrFail()

    const planType = plan.slug.replace('individual-', '') as 'monthly' | 'quarterly' | 'annual'

    const desluggedPayload = {
      plan_type: planType,
      product_id: plan.productId,
      quantity: payload.quantity,
      customer: payload.customer,
      billing: payload.billing,
    }

    const result = await this.individualSubscriptionService.createIndividualSubscription(
      user.id,
      desluggedPayload
    )

    return response.created(result)
  }

  async changePlan({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const payload = await request.validateUsing(changeIndividualPlanValidator)

    // Lookup plan by slug
    const plan = await Plan.query().where('slug', payload.plan_slug).firstOrFail()

    // Derive plan type from slug (assuming slug format like "individual-monthly")
    const planType = plan.slug.replace('individual-', '') as 'monthly' | 'quarterly' | 'annual'

    const params = {
      newProductId: plan.productId,
      quantity: payload.quantity,
      prorationBillingMode: payload.proration_billing_mode,
    }

    const result = await this.individualSubscriptionService.changeIndividualSubscriptionPlan(
      user.id,
      planType,
      params
    )

    return response.ok(result)
  }

  async cancel({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()

    await this.individualSubscriptionService.cancelIndividualSubscription(user.id)

    return response.ok({ message: 'Subscription cancelled successfully.' })
  }

  async restore({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()

    await this.individualSubscriptionService.restoreIndividualSubscription(user.id)

    return response.ok({ message: 'Successfully restored subscription.' })
  }

  async show({ auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const result = await this.individualSubscriptionService.getIndividualSubscriptionDetails(
        user.id
      )

      return response.ok(result)
    } catch {
      return response.badRequest({
        message: 'Failed to load subscription',
      })
    }
  }

  async getCustomerPortalLink({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const result = await this.individualSubscriptionService.getCustomerPortalLink(user.id)
    return response.ok(result)
  }
}
