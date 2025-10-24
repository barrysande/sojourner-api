import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import IndividualSubscription from '#models/individual_subscription'
import User from '#models/user'
import TierService from './tier_service.js'
import { GracePeriodService } from './grace_period_service.js'
import db from '@adonisjs/lucid/services/db'
import TierAuditLog from '#models/tier_audit_log'

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
  constructor(
    protected tierService: TierService,
    protected gracePeriodService: GracePeriodService
  ) {}

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

    return await db.transaction(async (trx) => {
      // 3. call dodo payments api

      // 4. Store subscription record

      const subscription = await IndividualSubscription.create(
        {
          userId,
          planType,
          status: 'active',
          expiresAt: this.calculateExpiresAt(planType),
        },
        { client: trx }
      )

      // 5. Update the user's tier
      await this.tierService.updateUserTier(
        userId,
        `Individual ${planType} subscription created`,
        'manual',
        {
          subscriptionId: subscription.id,
          // dodoSubscriptionId: dodoResponse.subscription_id,
        }
      )
      return {
        subscription,
        // paymentUrl: dodoResponse.payment_link,
      }
    })
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
    // 1. check user's subscription status
    const subscription = await IndividualSubscription.query()
      .where('user_id', userId)
      .where('status', 'active')
      .firstOrFail()
    if (subscription.planType === newPlanType) {
      throw new Error(`Already subscribed to ${newPlanType} plan`)
    }

    return db.transaction(async (trx) => {
      // TODO 2. if newPlan not same as current plan call dodo api to change subscription and prorate immediately
      // 3. if successful, get current plan, then assign new plan to the subscription.planType, and save to db. No need to calculate and set expiry, dodo will set it based on
      const oldPlanType = subscription.planType
      subscription.useTransaction(trx)
      subscription.planType = newPlanType
      subscription.expiresAt = this.calculateExpiresAt(newPlanType)
      await subscription.save()

      // 4. log tier change
      await TierAuditLog.create(
        {
          userId,
          oldTier: 'individual_paid',
          newTier: 'individual_paid',
          reason: `Plan changed from ${oldPlanType} to ${newPlanType}`,
          triggeredBy: 'manual',
          metadata: {
            oldPlanType,
            newPlanType,
            dodoSubscriptionId: subscription.dodoSubscriptionId,
            // proratedCharge: dodoResponse.prorated_amount,
          },
        },
        { client: trx }
      )

      logger.info('Individual subscription plan changed', {
        userId,
        subscriptionId: subscription.id,
        oldPlanType,
        newPlanType,
      })

      return subscription
    })
  }

  /**
   * Get active individual subscription for user
   */
  async getActiveIndividualSubscription(userId: number): Promise<IndividualSubscription | null> {
    return await IndividualSubscription.query()
      .where('user_id', userId)
      .where('status', 'active')
      .where('expires_at', '>', DateTime.now().toSQL())
      .orderBy('created_at', 'desc')
      .first()
  }

  /**
   * Handle payment success webhook from Dodo
   * Extends expires_at and clears grace periods
   *
   * @param dodoSubscriptionId - Dodo subscription ID
   * @param eventId - Webhook event ID for logging/auditing
   */
  async handlePaymentSuccess(dodoSubscriptionId: string, eventId: string): Promise<void> {
    // 1. get sub
    const subscription = await IndividualSubscription.query()
      .where('dodo_subscription_id', dodoSubscriptionId)
      .preload('user')
      .firstOrFail()

    // 2. extend expiry date on the sub
    subscription.expiresAt = this.calculateExpiresAt(subscription.planType)
    subscription.status = 'active'
    await subscription.save()

    // 3. clear active grace period
    await this.gracePeriodService.clearGracePeriod(subscription.userId)

    // 4. Update tier (in case user was in grace period)
    await this.tierService.updateUserTier(
      subscription.userId,
      'Payment successful - subscription renewed',
      'webhook',
      {
        dodoSubscriptionId,
        eventId,
        expiresAt: subscription.expiresAt.toISO(),
      }
    )

    logger.info('Individual subscription payment successful', {
      userId: subscription.userId,
      subscriptionId: subscription.id,
      dodoSubscriptionId,
      eventId,
      newExpiresAt: subscription.expiresAt.toISO(),
    })
  }

  /**
   * Handle payment failure webhook from Dodo
   * Starts 3-day grace period
   *
   * @param dodoSubscriptionId - Dodo subscription ID
   * @param eventId - Webhook event ID for logging/auditing
   */
  async handlePaymentFailure(dodoSubscriptionId: string, eventId: string): Promise<void> {
    // 1. get sub
    const subscription = await IndividualSubscription.query()
      .where('dodo_subscription_id', dodoSubscriptionId)
      .preload('user')
      .firstOrFail()

    // 2. start grace period
    await this.gracePeriodService.startGracePeriod(
      subscription.userId,
      'payment_failure',
      'individual_paid'
    )

    logger.warn('Individual subscription payment failed - grace period started', {
      userId: subscription.userId,
      subscriptionId: subscription.id,
      dodoSubscriptionId,
      eventId,
      expiresAt: subscription.expiresAt.toISO(),
    })

    // 3. TODO: Send email notification to user about payment failure
    // await this.emailService.sendPaymentFailureEmail(subscription.user.email)
  }
  /**
   * Handle subscription expired webhook from Dodo
   * Marks subscription as expired and updates tier
   *
   * @param dodoSubscriptionId - Dodo subscription ID
   * @param eventId - Webhook event ID for logging/auditing
   */
  async handleSubscriptionExpired(dodoSubscriptionId: string, eventId: string): Promise<void> {
    // 1. get sub
    const subscription = await IndividualSubscription.query()
      .where('dodo_subscription_id', dodoSubscriptionId)
      .preload('user')
      .firstOrFail()

    // 2. set sub status to expired
    subscription.status = 'expired'
    await subscription.save()

    // 3. update user tier for
    await this.tierService.updateUserTier(
      subscription.userId,
      'Individual subscription expired',
      'webhook',
      {
        dodoSubscriptionId,
        eventId,
        expiredAt: subscription.expiresAt.toISO(),
      }
    )

    logger.info('Individual subscription expired', {
      userId: subscription.userId,
      subscriptionId: subscription.id,
      dodoSubscriptionId,
      eventId,
    })
  }
}
