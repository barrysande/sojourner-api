import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import IndividualSubscription from '#models/individual_subscription'

import TierService from './tier_service.js'
import { GracePeriodService } from './grace_period_service.js'
import db from '@adonisjs/lucid/services/db'
import { DodoPaymentService } from './dodo_payment_service.js'
import type {
  CreateIndividualSubscriptionParams,
  SubscriptionsDetailsRetrieveResponse,
} from './dodo_payment_service.js'
import { ChangeSubscriptionPlan } from './dodo_payment_service.js'
import WebhookEvent from '#models/webhook_event'

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
  ): Promise<{ subscription: IndividualSubscription; paymentLink: string | null | undefined }> {
    return await db.transaction(async (trx) => {
      // 1. Call Dodo Payments API
      const dodoResponse = await this.dodoPaymentService.createIndividualSubscription(params)

      // 2. Store subscription record
      const subscription = await IndividualSubscription.create(
        {
          userId,
          dodoSubscriptionId: dodoResponse.subscription_id,
          planType,
          status: 'pending',
          expiresAt: dodoResponse.expires_on
            ? DateTime.fromISO(dodoResponse.expires_on)
            : undefined,
        },
        { client: trx }
      )

      // 3. Return the subscription and payment link
      return {
        subscription,
        paymentLink: dodoResponse.payment_link,
      }
    })
  }

  /**
   * Change subscription plan (e.g., monthly -> annual)
   * Uses Dodo change_plan_subscriptions with proration
   */
  async changeSubscriptionPlan(
    userId: number,
    newPlanType: PlanType,
    params: ChangeSubscriptionPlan
  ): Promise<string> {
    // 1. check if user has an active subscription.
    return db.transaction(async (trx) => {
      const subscription = await IndividualSubscription.query({ client: trx })
        .where('user_id', userId)
        .where('status', 'active')
        .forUpdate()
        .firstOrFail()

      // 2. Validate that user isn't trying to change same plan
      if (subscription.planType === newPlanType) {
        throw new Error(`Already subscribed to ${newPlanType} plan`)
      }
      const oldPlanType = subscription.planType

      // 3. call dodo api to change subscription and prorate immediately - endpoint returns a success string, must fetch the new sub
      const dodoResponse = await this.dodoPaymentService.changeSubscriptionPlan(
        subscription.dodoSubscriptionId,
        params
      )
      // 4. Retrieve updated plan from dodo
      const updatedDodoDetails = await this.dodoPaymentService.retrieveSubscription(
        subscription.dodoSubscriptionId
      )

      // 5. update records
      await subscription
        .useTransaction(trx)
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
    })
  }

  /**
   * Cancel individual subscription (cancel_at_next_billing_date)
   * User keeps access until expiry
   */
  async cancelIndividualSubscription(
    userId: number
  ): Promise<Partial<SubscriptionsDetailsRetrieveResponse>> {
    return await db.transaction(async (trx) => {
      // 1. check if user has an active subscription.

      const subscription = await IndividualSubscription.query({ client: trx })
        .where('user_id', userId)
        .where('status', 'active')
        .forUpdate()
        .firstOrFail()

      // 2. call dodo api to cancel the sub at next billing date.
      const dodoResponse = await this.dodoPaymentService.cancelSubscription(
        subscription.dodoSubscriptionId,
        true
      )

      await subscription.useTransaction(trx).merge({ status: 'cancelled' }).save()

      return dodoResponse
    })
  }

  /**
   * Handle payment success webhook from Dodo
   * Extends expires_at and clears grace periods
   *
   * @param dodoSubscriptionId - Dodo subscription ID
   * @param eventId - Webhook event ID for logging/auditing
   */
  async handlePaymentSuccess(dodoSubscriptionId: string, eventId: string): Promise<void> {
    try {
      await db.transaction(async (trx) => {
        // 1. Check idempotency - have to so that dodo does not retry the webhook delivery
        const existingEvent = await WebhookEvent.query({ client: trx })
          .where('event_id', eventId)
          .forUpdate()
          .first()

        if (existingEvent) {
          logger.info('Webhook already processed, skipping', { eventId, dodoSubscriptionId })
          return // Return successfully to prevent Dodo from retrying
        }

        await WebhookEvent.create(
          {
            eventId,
            eventType: 'payment.succeeded',
            resourceId: dodoSubscriptionId,
            processedAt: DateTime.now(),
          },
          { client: trx }
        )

        const subscription = await IndividualSubscription.query({ client: trx })
          .where('dodo_subscription_id', dodoSubscriptionId)
          .forUpdate()
          .firstOrFail()

        logger.info('Processing payment success for individual subscription', {
          subscriptionId: subscription.id,
          userId: subscription.userId,
          currentStatus: subscription.status,
        })

        const dodoDetails = await this.dodoPaymentService.retrieveSubscription(dodoSubscriptionId)

        await subscription
          .useTransaction(trx)
          .merge({
            status: 'active',
            expiresAt: dodoDetails.expires_at
              ? DateTime.fromISO(dodoDetails.expires_at)
              : undefined,
          })
          .save()

        await this.gracePeriodService.clearGracePeriod(subscription.userId, trx)

        logger.info('Individual subscription payment success processed', {
          subscriptionId: subscription.id,
          userId: subscription.userId,
          newExpiresAt: subscription.expiresAt.toISO(),
        })
      })
    } catch (error) {
      if (error.code === '23505') {
        logger.info('Duplicate webhook event detected, already processed', {
          eventId,
          dodoSubscriptionId,
        })
        return // Return successfully to prevent Dodo from retrying
      }

      // Re-throw any other errors so Dodo retries
      throw error
    }
  }

  /**
   * Handle payment failure webhook from Dodo
   * Starts 3-day grace period
   *
   * @param dodoSubscriptionId - Dodo subscription ID
   * @param eventId - Webhook event ID for logging/auditing
   */
  async handlePaymentFailure(dodoSubscriptionId: string, eventId: string): Promise<void> {
    try {
      await db.transaction(async (trx) => {
        // 1. Check idempotency - have to so that dodo does not retry the webhook delivery
        const existingEvent = await WebhookEvent.query({ client: trx })
          .where('event_id', eventId)
          .forUpdate()
          .first()

        if (existingEvent) {
          logger.info('Webhook already processed, skipping', { eventId, dodoSubscriptionId })
          return
        }

        await WebhookEvent.create(
          {
            eventId,
            eventType: 'payment.failed',
            resourceId: dodoSubscriptionId,
            processedAt: DateTime.now(),
          },
          { client: trx }
        )

        const subscription = await IndividualSubscription.query({ client: trx })
          .where('dodo_subscription_id', dodoSubscriptionId)
          .forUpdate()
          .firstOrFail()

        logger.info('Processing payment failure for individual subscription', {
          subscriptionId: subscription.id,
          userId: subscription.userId,
        })

        await subscription.useTransaction(trx).merge({ status: 'failed' }).save()

        await this.gracePeriodService.startGracePeriod(
          subscription.userId,
          'payment_failure',
          'individual_paid',
          trx
        )
      })

      // TODO: Send email notification to user about payment failure
      // await this.emailService.sendPaymentFailureEmail(subscription.user.email)
    } catch (error) {
      if (error.code === '23505') {
        logger.info('Duplicate webhook event detected, already processed', {
          eventId,
          dodoSubscriptionId,
        })
        return // Return successfully to prevent Dodo from retrying
      }

      // Re-throw any other errors so Dodo retries
      throw error
    }
  }
  /**
   * Handle subscription expired webhook from Dodo
   * Marks subscription as expired and updates tier
   *
   * @param dodoSubscriptionId - Dodo subscription ID
   * @param eventId - Webhook event ID for logging/auditing
   */
  async handleSubscriptionExpired(dodoSubscriptionId: string, eventId: string): Promise<void> {
    try {
      await db.transaction(async (trx) => {
        const existingEvent = await WebhookEvent.query({ client: trx })
          .where('event_id', eventId)
          .forUpdate()
          .first()

        if (existingEvent) {
          logger.info('Webhook already processed, skipping', { eventId, dodoSubscriptionId })
          return
        }

        await WebhookEvent.create(
          {
            eventId,
            eventType: 'subscription.expired',
            resourceId: dodoSubscriptionId,
            processedAt: DateTime.now(),
          },
          { client: trx }
        )

        const subscription = await IndividualSubscription.query({ client: trx })
          .where('dodo_subscription_id', dodoSubscriptionId)
          .forUpdate()
          .firstOrFail()

        logger.info('Processing subscription expiration for individual subscription', {
          subscriptionId: subscription.id,
          userId: subscription.userId,
        })

        await subscription.useTransaction(trx).merge({ status: 'expired' }).save()

        await this.gracePeriodService.startGracePeriod(
          subscription.userId,
          'payment_failure',
          'individual_paid',
          trx
        )
      })
    } catch (error) {
      if (error.code === '23505') {
        logger.error('Failed to process subscription expiration webhook', {
          error: error.message,
          eventId,
          dodoSubscriptionId,
        })
        throw error
      }
    }
  }
}
