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

    const result = await this.individualSubscriptionService.createIndividualSubscription(
      user.id,
      payload
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

  async getCustomerPortalLink({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const result = await this.individualSubscriptionService.getCustomerPortalLink(user.id)
    return response.ok(result)
  }
}
