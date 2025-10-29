import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import IndividualSubscription from '#models/individual_subscription'
import TierService from './tier_service.js'
import { GracePeriodService } from './grace_period_service.js'
import { DodoPaymentService } from './dodo_payment_service.js'
import type {
  CreateIndividualSubscriptionParams,
  SubscriptionsDetailsRetrieveResponse,
  ChangeIndividualSubscriptionPlanParams,
} from './dodo_payment_service.js'
import type { SubscriptionCreateResponse } from 'dodopayments/resources/subscriptions.mjs'

type PlanType = 'monthly' | 'quarterly' | 'annual'
// type SubscriptionStatus =  'pending' | 'active' | 'on_hold' | 'cancelled' | 'failed' | 'expired'

@inject()
export class IndividualSubscriptionService {
  constructor(
    protected tierService: TierService,
    protected gracePeriodService: GracePeriodService,
    protected dodoPaymentService: DodoPaymentService
  ) {}

  /**
   * Create individual subscription via dodo_payments_service
   * @param userId - User subscribing
   * @param planType - 'monthly' | 'quarterly' | 'annual'
   * @param productId - Dodo product ID
   * @param billingAddress - Customer billing address
   * @param customer - Customer information for Dodo
   * @param quantity - quantity of the subscription which is always 1
   */
  async createIndividualSubscription(
    userId: number,
    planType: PlanType,
    params: CreateIndividualSubscriptionParams
  ): Promise<SubscriptionCreateResponse> {
    const dodoResponse = await this.dodoPaymentService.createIndividualSubscription(params)

    await IndividualSubscription.create({
      userId,
      dodoSubscriptionId: dodoResponse.subscription_id,
      planType,
      status: 'pending',
      expiresAt: dodoResponse.expires_on ? DateTime.fromISO(dodoResponse.expires_on) : undefined,
    })

    return {
      addons: dodoResponse.addons,
      customer: dodoResponse.customer,
      metadata: dodoResponse.metadata,
      payment_id: dodoResponse.payment_id,
      recurring_pre_tax_amount: dodoResponse.recurring_pre_tax_amount,
      subscription_id: dodoResponse.subscription_id,
    }
  }

  /**
   * Change subscription plan (e.g., monthly -> annual)
   * Uses Dodo change_plan_subscriptions with proration
   */
  async changeIndividualSubscriptionPlan(
    userId: number,
    newPlanType: PlanType,
    params: ChangeIndividualSubscriptionPlanParams
  ): Promise<string> {
    // 1. check if user has an active subscription.
    const subscription = await IndividualSubscription.query()
      .where('user_id', userId)
      .where('status', 'active')
      .firstOrFail()

    // 2. Validate that user isn't trying to change same plan
    if (subscription.planType === newPlanType) {
      throw new Error(`Already subscribed to ${newPlanType} plan`)
    }
    const oldPlanType = subscription.planType

    // 3. call dodo api to change subscription and prorate immediately - endpoint returns a success string, must fetch the new sub
    const dodoResponse = await this.dodoPaymentService.changeIndividualSubscriptionPlan(
      subscription.dodoSubscriptionId,
      params
    )
    // 4. Retrieve updated plan from dodo
    const updatedDodoDetails = await this.dodoPaymentService.retrieveSubscription(
      subscription.dodoSubscriptionId
    )

    // 5. update records
    await subscription
      .merge({
        planType: newPlanType,
        expiresAt: updatedDodoDetails.expires_at
          ? DateTime.fromISO(updatedDodoDetails.expires_at)
          : undefined,
      })
      .save()

    logger.info('Individual subscription plan changed', {
      userId,
      subscriptionId: subscription.id,
      oldPlanType,
      newPlanType,
      newExpiresAt: subscription.expiresAt.toISO(),
    })

    return dodoResponse
  }

  /**
   * Cancel individual subscription (cancel_at_next_billing_date)
   * User keeps access until expiry
   */
  async cancelIndividualSubscription(
    userId: number
  ): Promise<Partial<SubscriptionsDetailsRetrieveResponse>> {
    // 1. check if user has an active subscription.
    const subscription = await IndividualSubscription.query()
      .where('user_id', userId)
      .where('status', 'active')
      .firstOrFail()

    // 2. call dodo api to cancel the sub at next billing date.
    const dodoResponse = await this.dodoPaymentService.cancelSubscription(
      subscription.dodoSubscriptionId,
      true
    )

    await subscription.merge({ status: 'cancelled' }).save()

    return dodoResponse
  }
}
