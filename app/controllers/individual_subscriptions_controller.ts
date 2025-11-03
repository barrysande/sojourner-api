import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import IndividualSubscriptionService from '#services/individual_subscription_service'
import {
  createIndividualSubscriptionValidator,
  changeIndividualPlanValidator,
} from '#validators/subscription'

@inject()
export default class IndividualSubscriptionsController {
  constructor(protected individualSubscriptionService: IndividualSubscriptionService) {}

  async create({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const payload = await request.validateUsing(createIndividualSubscriptionValidator)

    const params = {
      productId: payload.product_id,
      quantity: payload.quantity,
      customer: {
        email: payload.customer.email,
        name: payload.customer.name,
        phoneNumber: payload.customer.phone_number,
      },

      billing: {
        street: payload.billing.street,
        city: payload.billing.city,
        state: payload.billing.state,
        zipcode: payload.billing.zipcode,
        country: payload.billing.country,
      },
      metadata: payload.metadata,
      returnUrl: payload.return_url,
      paymentLink: payload.payment_link,
      trialPeriodDays: payload.trial_period_days,
    }

    const result = await this.individualSubscriptionService.createIndividualSubscription(
      user.id,
      payload.plan_type,
      params
    )

    return response.created(result)
  }

  async changePlan({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const payload = await request.validateUsing(changeIndividualPlanValidator)
    const params = {
      newProductId: payload.new_product_id,
      quantity: payload.quantity,
      prorationBillingMode: payload.proration_billing_mode,
    }

    const result = await this.individualSubscriptionService.changeIndividualSubscriptionPlan(
      user.id,
      payload.new_plan_type,
      params
    )

    return response.ok(result)
  }

  async cancel({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const result = await this.individualSubscriptionService.cancelIndividualSubscription(user.id)

    return response.ok(result)
  }

  async show({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const result = await this.individualSubscriptionService.getIndividualSubscriptionDetails(
      user.id
    )

    return response.ok(result)
  }
}
