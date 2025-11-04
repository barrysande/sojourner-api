import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import IndividualSubscription from '#models/individual_subscription'
import TierService from './tier_service.js'
import GracePeriodService from './grace_period_service.js'
import DodoPaymentService from './dodo_payment_service.js'
import type {
  CreateIndividualSubscriptionParams,
  ChangeIndividualSubscriptionPlanParams,
} from '../../types/webhook.js'
import type {
  SubscriptionCreateResponse,
  Subscription,
} from 'dodopayments/resources/subscriptions.mjs'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'

type PlanType = 'monthly' | 'quarterly' | 'annual'
// type SubscriptionStatus =  'pending' | 'active' | 'on_hold' | 'cancelled' | 'failed' | 'expired'

@inject()
export default class IndividualSubscriptionService {
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
    })

    return {
      addons: dodoResponse.addons,
      client_secret: dodoResponse.client_secret,
      payment_link: dodoResponse.payment_link,
      customer: dodoResponse.customer,
      metadata: dodoResponse.metadata,
      payment_id: dodoResponse.payment_id,
      recurring_pre_tax_amount: dodoResponse.recurring_pre_tax_amount,
      subscription_id: dodoResponse.subscription_id,
    }
  }

  /**
   * Change subscription plan (e.g., monthly -> annual)
   *
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
   *
   * User keeps access until expiry
   */
  async cancelIndividualSubscription(userId: number): Promise<Partial<Subscription>> {
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

    return dodoResponse
  }

  async getIndividualSubscriptionDetails(userId: number): Promise<IndividualSubscription | null> {
    return await IndividualSubscription.query()
      .where('user_id', userId)
      .where('status', 'active')
      .where('expires_at', '>', DateTime.now().toSQL())
      .first()
  }

  /**
   * Handles payment subscription.active webhook from Dodo
   *
   * Changes subscription status to active
   *
   * Updates tier
   *
   * @param dodoSubscriptionId string
   *
   * @param expiresAt string The webhook processor service passes it to this function in the ISO string format.
   *
   * @param trx TransactionClientContract
   */
  async handleSubscriptionActive(
    dodoSubscriptionId: string,
    expiresAt: string,
    trx: TransactionClientContract
  ): Promise<void> {
    const subscription = await IndividualSubscription.query({ client: trx })
      .where('dodo_subscription_id', dodoSubscriptionId)
      .preload('user')
      .forUpdate()
      .firstOrFail()

    await subscription
      .useTransaction(trx)
      .merge({ status: 'active', expiresAt: DateTime.fromISO(expiresAt) })
      .save()

    await this.gracePeriodService.clearGracePeriod(subscription.userId, trx)

    await this.tierService.updateUserTier(
      subscription.userId,
      'Payment successful - subscription created',
      'webhook',
      trx,
      {}
    )

    logger.info('Individual subscription payment successful', {
      userId: subscription.userId,
      subscriptionId: subscription.id,
      dodoSubscriptionId,
      newExpiresAt: subscription.expiresAt.toISO(),
    })
  }

  /**
   * Handles payment subscription.renewed webhook from Dodo
   *
   * Changes subscription status to active if not active
   *
   * Clears any grace period
   *
   * Updates tier
   *
   * @param dodoSubscriptionId string
   *
   * @param newExpiresAt string The webhook processor service passes it to this function in the ISO string format.
   *
   * @param trx TransactionClientContract
   */
  async handleSubscriptionRenewed(
    dodoSubscriptionId: string,
    newExpiresAt: string,
    trx: TransactionClientContract
  ): Promise<void> {
    const subscription = await IndividualSubscription.query({ client: trx })
      .where('dodo_subscription_id', dodoSubscriptionId)
      .preload('user')
      .forUpdate()
      .firstOrFail()

    await subscription
      .useTransaction(trx)
      .merge({ expiresAt: DateTime.fromISO(newExpiresAt), status: 'active' })
      .save()

    await this.gracePeriodService.clearGracePeriod(subscription.userId, trx)

    await this.tierService.updateUserTier(
      subscription.userId,
      'Payment successful - subscription renewed',
      'webhook',
      trx,
      {}
    )

    logger.info('Individual subscription renewal successful', {
      userId: subscription.userId,
      subscriptionId: subscription.id,
      dodoSubscriptionId,
      newExpiresAt: subscription.expiresAt.toISO(),
    })
  }

  /**
   * Handles subscription individual subscription.plan_changed webhook from Dodo
   *
   * Changes subscription status to cancelled

   * Updates tier
   *
   * @param dodoSubscriptionId string
   * 
   * @param newPlanType of type PLanType. String union.
   * 
   * @param newExpiresAt string The webhook processor service passes it to this function in the ISO string format.
   *
   * @param trx TransactionClientContract
   * 
   */
  async handleSubscriptionPlanChanged(
    dodoSubscriptionId: string,
    newPlanType: PlanType,
    newExpiresAt: string,
    trx: TransactionClientContract
  ): Promise<void> {
    const subscription = await IndividualSubscription.query({ client: trx })
      .where('dodo_subscription_id', dodoSubscriptionId)
      .preload('user')
      .forUpdate()
      .firstOrFail()

    await subscription
      .useTransaction(trx)
      .merge({ status: 'active', planType: newPlanType, expiresAt: DateTime.fromISO(newExpiresAt) })
      .save()

    logger.info('Individual subscription plan change successful', {
      userId: subscription.userId,
      subscriptionId: subscription.id,
      dodoSubscriptionId,
      newExpiresAt: subscription.expiresAt.toISO(),
    })
  }

  /**
   * Handle subscription individual subscription.cancelled webhook from Dodo
   *
   * Changes subscription status to cancelled

   * Update tier
   *
   * @param dodoSubscriptionId string
   *
   * @param trx TransactionClientContract
   */
  async handleSubscriptionCancelled(
    dodoSubscriptionId: string,
    trx: TransactionClientContract
  ): Promise<void> {
    const subscription = await IndividualSubscription.query({ client: trx })
      .where('dodo_subscription_id', dodoSubscriptionId)
      .preload('user')
      .forUpdate()
      .firstOrFail()

    await subscription.useTransaction(trx).merge({ status: 'cancelled' }).save()

    await this.tierService.updateUserTier(
      subscription.userId,
      'Subscription cancelled.',
      'webhook',
      trx,
      {}
    )

    logger.warn('Individual subscription cancelled', {
      userId: subscription.userId,
      subscriptionId: subscription.id,
      dodoSubscriptionId,
      newExpiresAt: subscription.expiresAt.toISO(),
    })
  }

  /**
   * Handles individual subscription.expired webhook from Dodo
   *
   * Changes subscription status to expired
   *
   * Starts 3-day grace period
   *
   * Updates tier
   *
   * @param dodoSubscriptionId string
   *
   * @param trx TransactionClientContract
   */
  async handleSubscriptionExpired(
    dodoSubscriptionId: string,
    trx: TransactionClientContract
  ): Promise<void> {
    const subscription = await IndividualSubscription.query({ client: trx })
      .where('dodo_subscription_id', dodoSubscriptionId)
      .preload('user')
      .forUpdate()
      .firstOrFail()

    await subscription.useTransaction(trx).merge({ status: 'expired' }).save()

    await this.gracePeriodService.startGracePeriod(
      subscription.userId,
      'payment_failure',
      'individual_paid',
      trx
    )

    await this.tierService.updateUserTier(
      subscription.userId,
      'Subscription expired - not renewed.',
      'webhook',
      trx,
      {}
    )
  }
  /**
   * Handles the individual subscription.on_hold and subscription.failed webhook events from Dodo
   *
   * Changes subscription status to failed
   *
   * Starts 3-day grace period
   *
   * Updates tier
   *
   * @param dodoSubscriptionId string
   *
   * @param trx TransactionClientContract
   */
  async handleSubscriptionFailed(
    dodoSubscriptionId: string,
    trx: TransactionClientContract
  ): Promise<void> {
    const subscription = await IndividualSubscription.query({ client: trx })
      .where('dodo_subscription_id', dodoSubscriptionId)
      .preload('user')
      .forUpdate()
      .firstOrFail()

    await subscription.useTransaction(trx).merge({ status: 'failed' }).save()

    logger.warn('Individual subscription payment failed', {
      userId: subscription.userId,
      subscriptionId: subscription.id,
      dodoSubscriptionId,
      expiresAt: subscription.expiresAt.toISO(),
    })

    await this.gracePeriodService.startGracePeriod(
      subscription.userId,
      'payment_failure',
      'individual_paid',
      trx
    )

    await this.tierService.updateUserTier(subscription.userId, 'Payment failed', 'webhook', trx, {})
  }
}
