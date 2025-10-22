import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import IndividualSubscription from '#models/individual_subscription'
import User from '#models/user'
import TierService from './tier_service.js'

type PlanType = 'monthly' | 'quarterly' | 'annual'
type SubscriptionStatus = 'active' | 'cancelled' | 'expired'

interface BillingAddress {
  street: string
  city: string
  state: string
  zipcode: string
  country: string
}

interface CustomerData {
  email: string
  name: string
  phone_number?: string
}

@inject()
export class IndividualSubscriptionService {
  constructor(protected tierService: TierService) {}
  /**
   * Create individual subscription via Dodo Payments
   * @param userId - User subscribing
   * @param planType - monthly/quarterly/annual
   * @param productId - Dodo product ID (from dashboard)
   * @param billingAddress - Customer billing address
   * @param customer - Customer information for Dodo
   */

  async createIndividualSubscription(
    userId: number,
    planType: PlanType,
    productId: number,
    billingAddress: BillingAddress,
    customer: CustomerData
  ): Promise<{ subscription: IndividualSubscription; paymentUrl?: string }> {
    const user = await User.findOrFail(userId)

    // 1. check if user can subscribe
    const canSubscribe = await this.tierService.canSubscribeIndividual(userId)
    if (!canSubscribe.canSubscribe) {
      throw new Error(canSubscribe.reason)
    }

    // 2. check if user has an active individual subscription
    const existingActive = await IndividualSubscription.query()
      .where('user_id', userId)
      .where('status', 'active')
      .first()
    if (existingActive) {
      throw new Error('User already has an active individual subscription')
    }

    // Note that steps 3, 4, and 5 should be locked in a transaction.

    // 3. call dodo payments api

    // 4. Store subscription record

    const subscription = await IndividualSubscription.create({
      userId,
      planType,
      status: 'active',
      expiresAt: this.calculateExpiresAt(planType),
    })

    // 5. Update the user's tier
    return {
      subscription,
      // paymentUrl
    }
  }

  /**
   * Cancel individual subscription (cancel_at_next_billing_date)
   * User keeps access until expiry
   */
  async cancelIndividualSubscription(userId: number): Promise<IndividualSubscription> {
    // 1. check if user has an active subscription
    const subscription = await IndividualSubscription.query()
      .where('user_id', userId)
      .where('status', 'active')
      .firstOrFail()

    // 2. call dodo api to cancel the sub at next billing date.

    // 3. if dodo api response confirms cancellation, then save
    subscription.status = 'cancelled'
    await subscription.save()

    logger.info('Individual subscription cancelled', {
      userId,
      subscriptionId: subscription.id,
      dodoSubscriptionId: subscription.dodoSubscriptionId,
      expiresAt: subscription.expiresAt.toISO(),
    })

    return subscription
  }

  /**
   * Change subscription plan (e.g., monthly -> annual)
   * Uses Dodo change_plan_subscriptions with proration
   */
  async changeSubscriptionPlan(
    userId: number,
    newPlanType: PlanType,
    newProductId: string
  ): Promise<IndividualSubscription> {
    // 1. chcke user's subscription status
    const subscription = await IndividualSubscription.query()
      .where('user_id', userId)
      .where('status', 'active')
      .firstOrFail()
    if (subscription.planType === newPlanType) {
      throw new Error(`Already subscribed to ${newPlanType} plan`)
    }

    // 2. if newPlan not same as current plan call dodo api to change subscription and prorate immediately

    // 3. if successful, get current plan, then assign new plan to the subscription.planType, set expiry date, and save to db.

    logger.info('Individual subscription plan changed', {
      userId,
      subscriptionId: subscription.id,
      // oldPlanType,
      newPlanType,
    })

    return subscription
  }

  private calculateExpiresAt(planType: PlanType): DateTime {
    const now = DateTime.now()
    switch (planType) {
      case 'monthly':
        return now.plus({ months: 1 })
      case 'quarterly':
        return now.plus({ months: 3 })
      case 'annual':
        return now.plus({ years: 1 })
      default:
        throw new Error(`Invalid plan type: ${planType}`)
    }
  }

  async getActiveIndividualSubscription(userId: number): Promise<IndividualSubscription | null> {
    return await IndividualSubscription.query()
      .where('user_id', userId)
      .where('status', 'active')
      .where('expires_at', '>', DateTime.now().toSQL())
      .orderBy('created_at', 'desc')
      .first()
  }
}
