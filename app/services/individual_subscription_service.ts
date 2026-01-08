import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import IndividualSubscription from '#models/individual_subscription'
import TierService from './tier_service.js'
import GracePeriodService from './grace_period_service.js'
import DodoPaymentService from './dodo_payment_service.js'
import type {
  ChangeIndividualSubscriptionPlanParams,
  CreateIndividualSubscriptionParams,
  SubscriptionCreateResponse,
} from '../../types/payments.js'
import type { Subscription } from 'dodopayments/resources/subscriptions.mjs'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import User from '#models/user'
import SubscriptionConflictException from '#exceptions/subscription_conflict_exception'
import { createIndivSubPaylodValidator } from '#validators/subscription'
import type { Infer } from '@vinejs/vine/types'
import { Exception } from '@adonisjs/core/exceptions'

type CreateSubPayload = Infer<typeof createIndivSubPaylodValidator>

type PlanType = 'monthly' | 'quarterly' | 'annual'

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
    payload: CreateSubPayload
  ): Promise<SubscriptionCreateResponse> {
    const { canSubscribe, reason } = await this.tierService.canSubscribeIndividual(userId)

    if (!canSubscribe) {
      throw new SubscriptionConflictException(reason!)
    }

    const dodoParams: CreateIndividualSubscriptionParams = {
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
      returnUrl: payload.return_url,
      confirm: true,

      // Edge Case: VERY VITAL for for self-recovery incase a user pays but for some reason like sudden outage either on my server or client's internet issue and the database fails to create a subscription record with pending status. The scheduled worker will use the userId and subscription_type to recreate it thereby correcting the failure. This means the job will be successfully processed.
      metadata: {
        ...payload.metadata,
        userId: userId.toString(),
        subscription_type: 'individual',
      },
    }

    const dodoResponse = await this.dodoPaymentService.createIndividualSubscription(dodoParams)

    try {
      await IndividualSubscription.create({
        userId,
        dodoSessionId: dodoResponse.sessionId,
        dodoSubscriptionId: null,
        planType: payload.plan_type,
        status: 'pending',
      })
    } catch (dbError) {
      logger.error('Failed to save subscription record after payment success', {
        dodoSessionId: dodoResponse.sessionId,
        userId,
        error: dbError,
      })
      throw new Exception(
        'Payment was processed but failed to update account. Please contact support.'
      )
    }

    return {
      checkoutUrl: dodoResponse.checkoutUrl,
      sessionId: dodoResponse.sessionId,
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
    const subscription = await IndividualSubscription.query()
      .where('user_id', userId)
      .where('status', 'active')
      .firstOrFail()

    if (subscription.planType === newPlanType) {
      throw new Error(`Already subscribed to ${newPlanType} plan`)
    }
    const oldPlanType = subscription.planType

    const dodoResponse = await this.dodoPaymentService.changeIndividualSubscriptionPlan(
      subscription.dodoSubscriptionId!,
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
    const subscription = await IndividualSubscription.query()
      .where('user_id', userId)
      .where('status', 'active')
      .firstOrFail()

    const dodoResponse = await this.dodoPaymentService.cancelSubscription(
      subscription.dodoSubscriptionId!,
      true
    )

    await subscription.merge({ cancelAtNextBillingDate: true }).save()

    return dodoResponse
  }

  async getIndividualSubscriptionDetails(userId: number): Promise<IndividualSubscription> {
    return await IndividualSubscription.query()
      .where('user_id', userId)
      .where('status', 'active')
      .where('expires_at', '>', DateTime.now().toSQL())
      .firstOrFail()
  }

  /**
   * Handles payment subscription.active webhook from Dodo
   *
   * Populates dodoSubscriptionId and changes status to active
   *
   * Updates tier
   *
   * @param userId number
   *
   * @param dodoSubscriptionId string - The actual subscription ID from Dodo
   *
   * @param expiresAt string The webhook processor service passes it to this function in the ISO string format.
   *
   * @param trx TransactionClientContract
   */
  async handleSubscriptionActive(
    userId: number,
    dodoSubscriptionId: string,
    dodoCustomerId: string,
    expiresAt: string,
    trx: TransactionClientContract
  ): Promise<User> {
    const subscription = await IndividualSubscription.query({ client: trx })
      .where('user_id', userId)
      .preload('user')
      .forUpdate()
      .firstOrFail()

    const user = subscription.user

    await subscription
      .useTransaction(trx)
      .merge({
        dodoSubscriptionId,
        dodoCustomerId,
        status: 'active',
        expiresAt: DateTime.fromISO(expiresAt),
      })
      .save()

    await this.gracePeriodService.clearGracePeriod(subscription.userId, trx)

    await this.tierService.updateUserTier(
      subscription.userId,
      'Payment successful - subscription activated',
      'webhook',
      trx,
      { dodo_subscription_id: dodoSubscriptionId }
    )

    logger.info('Individual subscription payment successful', {
      userId: subscription.userId,
      subscriptionId: subscription.id,
      dodoSubscriptionId,
      newExpiresAt: subscription.expiresAt.toISO(),
    })

    return user
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
   * @param userId number
   *
   * @param newExpiresAt string The webhook processor service passes it to this function in the ISO string format.
   *
   * @param trx TransactionClientContract
   */
  async handleSubscriptionRenewed(
    userId: number,
    newExpiresAt: string,
    trx: TransactionClientContract
  ): Promise<User> {
    const subscription = await IndividualSubscription.query({ client: trx })
      .where('user_id', userId)
      .preload('user')
      .forUpdate()
      .firstOrFail()

    const user = subscription.user

    await subscription
      .useTransaction(trx)
      .merge({ expiresAt: DateTime.fromISO(newExpiresAt), status: 'active' })
      .save()

    await this.gracePeriodService.clearGracePeriod(subscription.userId, trx)

    logger.info('Individual subscription renewal successful', {
      userId: subscription.userId,
      subscriptionId: subscription.id,
      dodoSubscriptionId: subscription.dodoSubscriptionId,
      newExpiresAt: subscription.expiresAt.toISO(),
    })

    return user
  }

  /**
   * Handles subscription individual subscription.plan_changed webhook from Dodo
   *
   * Changes subscription status to active and updates plan type
   *
   * Updates tier
   *
   * @param userId number
   *
   * @param newPlanType of type PlanType. String union.
   *
   * @param newExpiresAt string The webhook processor service passes it to this function in the ISO string format.
   *
   * @param trx TransactionClientContract
   *
   */
  async handleSubscriptionPlanChanged(
    userId: number,
    newPlanType: PlanType,
    newExpiresAt: string,
    trx: TransactionClientContract
  ): Promise<User> {
    const subscription = await IndividualSubscription.query({ client: trx })
      .where('user_id', userId)
      .preload('user')
      .forUpdate()
      .firstOrFail()

    const user = subscription.user

    await subscription
      .useTransaction(trx)
      .merge({ status: 'active', planType: newPlanType, expiresAt: DateTime.fromISO(newExpiresAt) })
      .save()

    logger.info('Individual subscription plan change successful', {
      userId: subscription.userId,
      subscriptionId: subscription.id,
      dodoSubscriptionId: subscription.dodoSubscriptionId,
      newPlanType,
      newExpiresAt: subscription.expiresAt.toISO(),
    })

    return user
  }

  /**
   * Handle subscription individual subscription.cancelled webhook from Dodo
   *
   * Changes subscription status to cancelled
   *
   * Updates tier
   *
   * @param userId number
   *
   * @param trx TransactionClientContract
   */
  async handleSubscriptionCancelled(userId: number, trx: TransactionClientContract): Promise<User> {
    const subscription = await IndividualSubscription.query({ client: trx })
      .where('user_id', userId)
      .preload('user')
      .forUpdate()
      .firstOrFail()

    const user = subscription.user

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
      dodoSubscriptionId: subscription.dodoSubscriptionId,
      expiresAt: subscription.expiresAt.toISO(),
    })

    return user
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
   * @param userId number
   *
   * @param trx TransactionClientContract
   */
  async handleSubscriptionExpired(userId: number, trx: TransactionClientContract): Promise<User> {
    const subscription = await IndividualSubscription.query({ client: trx })
      .where('user_id', userId)
      .preload('user')
      .forUpdate()
      .firstOrFail()

    const user = subscription.user

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

    logger.warn('Individual subscription expired', {
      userId: subscription.userId,
      subscriptionId: subscription.id,
      dodoSubscriptionId: subscription.dodoSubscriptionId,
    })

    return user
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
   * @param userId number
   *
   * @param trx TransactionClientContract
   */
  async handleSubscriptionFailed(userId: number, trx: TransactionClientContract): Promise<User> {
    const subscription = await IndividualSubscription.query({ client: trx })
      .where('user_id', userId)
      .preload('user')
      .forUpdate()
      .firstOrFail()

    const user = subscription.user

    await subscription.useTransaction(trx).merge({ status: 'failed' }).save()

    logger.warn('Individual subscription payment failed', {
      userId: subscription.userId,
      subscriptionId: subscription.id,
      dodoSubscriptionId: subscription.dodoSubscriptionId,
      expiresAt: subscription.expiresAt.toISO(),
    })

    await this.gracePeriodService.startGracePeriod(
      subscription.userId,
      'payment_failure',
      'individual_paid',
      trx
    )

    await this.tierService.updateUserTier(subscription.userId, 'Payment failed', 'webhook', trx, {})

    return user
  }

  async getCustomerPortalLink(userId: number): Promise<{ link: string }> {
    return await this.dodoPaymentService.getIndividualCustomerPortalLink(userId)
  }
}
