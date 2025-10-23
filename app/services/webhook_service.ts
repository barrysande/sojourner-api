import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import WebhookEvent from '#models/webhook_event'
import { IndividualSubscriptionService } from './individual_subscription_service.js'
import { GroupSubscriptionService } from './group_subscription_service.js'
import crypto from 'node:crypto'

export type DodoWebhookEvent =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'subscription.active'
  | 'subscription.renewed'
  | 'subscription.cancelled'
  | 'subscription.expired'
  | 'subscription.plan_changed'

export interface DodoWebhookPayload {
  eventId: string
  eventType: DodoWebhookEvent
  createdAt: string
  data: {
    subscription_id: string
    customer_id?: string
    status?: string
    [key: string]: any
  }
}

@inject()
export class WebhookService {
  constructor(
    protected individualSubscriptionService: IndividualSubscriptionService,
    protected groupSubscriptionService: GroupSubscriptionService
  ) {}

  /**
   * Handle payment success / subscription renewal
   * Both individual and group subscriptions
   */
  private async handlePaymentSuccess(
    dodoSubscriptionId: string,
    eventId: string,
    trx: any
  ): Promise<void> {
    // check which subscription has succeeded
    // 1.  try individual first
    const individualSub = await db
      .from('individual_subscriptions')
      .where('dodo_subscription_id', dodoSubscriptionId)
      .first()

    if (individualSub) {
      await this.individualSubscriptionService.handlePaymentSuccess(dodoSubscriptionId, eventId)

      logger.info('Individual subscription payment success processed', {
        eventId,
        dodoSubscriptionId,
        userId: individualSub.user_id,
      })
      return
    }

    // 2. try group
    const groupSub = await db
      .from('group_subscriptions')
      .where('dodo_subscription_id', dodoSubscriptionId)
      .first()

    if (groupSub) {
      await this.groupSubscriptionService.handlePaymentSuccess(dodoSubscriptionId, eventId)

      logger.info('Group subscription payment success processed', {
        eventId,
        dodoSubscriptionId,
        ownerId: groupSub.owner_user_id,
      })
      return
    }

    logger.error('Subscription not found for payment success webhook', {
      eventId,
      dodoSubscriptionId,
    })
  }

  /**
   * Handle payment failure
   * Triggers 3-day grace period for individual subscriptions
   */
  private async handlePaymentFailure(
    dodoSubscriptionId: string,
    eventId: string,
    trx: any
  ): Promise<void> {
    // check which subscription has succeeded
    // 1. try individual subscription first
    const individualSub = await db
      .from('individual_subscriptions')
      .where('dodo_subscription_id', dodoSubscriptionId)
      .first()

    if (individualSub) {
      await this.individualSubscriptionService.handlePaymentFailure(dodoSubscriptionId, eventId)
      logger.info('Individual subscription payment failure processed', {
        eventId,
        dodoSubscriptionId,
        userId: individualSub.user_id,
      })
      return
    }

    // 2. try group_sub
    const groupSub = await db
      .from('group_subscriptions')
      .where('dodo_subscription_id', dodoSubscriptionId)
      .first()

    if (groupSub) {
      await this.groupSubscriptionService.handlePaymentFailure(dodoSubscriptionId, eventId)
      logger.info('Group subscription payment failure processed', {
        eventId,
        dodoSubscriptionId,
        ownerId: groupSub.owner_user_id,
      })
      return
    }

    logger.error('Subscription not found for payment failure webhook', {
      eventId,
      dodoSubscriptionId,
    })
  }

  /**
   * Handle subscription activated
   * Will typically occur after initial payment
   */
  private async handleSubscriptionActive(
    dodoSubscriptionId: string,
    eventId: string,
    trx: any
  ): Promise<void> {
    logger.info('Subscription activated', { eventId, dodoSubscriptionId })
    // Same as payment success - activate subscription
    await this.handlePaymentSuccess(dodoSubscriptionId, eventId, trx)
  }

  /**
   * Handle subscription cancellation
   * Updates status but user keeps access until expiry
   */
  private async handleSubscriptionCancelled(
    dodoSubscriptionId: string,
    eventId: string,
    trx: any
  ): Promise<void> {
    // check which subscription has succeeded
    // 1. try individual subscription first
    const individualSub = await db
      .from('individual_subscriptions')
      .where('dodo_subscription_id', dodoSubscriptionId)
      .first()
    if (individualSub) {
      await db
        .from('individual_subscriptions')
        .where('dodo_subscription_id', dodoSubscriptionId)
        .update({ status: 'cancelled', updated_at: DateTime.now().toSQL() })
      logger.info('Individual subscription cancelled', {
        eventId,
        dodoSubscriptionId,
        userId: individualSub.user_id,
      })
      return
    }

    // 2. try group subscription
    const groupSub = await db
      .from('group_subscriptions')
      .where('dodo_subscription_id', dodoSubscriptionId)
      .first()

    if (groupSub) {
      await db
        .from('group_subscriptions')
        .where('dodo_subscription_id', dodoSubscriptionId)
        .update({ status: 'cancelled', updated_at: DateTime.now().toSQL() })

      logger.info('Group subscription cancelled', {
        eventId,
        dodoSubscriptionId,
        ownerId: groupSub.owner_user_id,
      })
      return
    }

    logger.error('Subscription not found for cancellation webhook', {
      eventId,
      dodoSubscriptionId,
    })
  }

  /**
   * Handle subscription expiration
   * Marks subscription as expired and triggers tier recalculation
   */
  private async handleSubscriptionExpired(
    dodoSubscriptionId: string,
    eventId: string,
    trx: any
  ): Promise<void> {
    // check which subscription has succeeded
    // Try individual subscription first
    const individualSub = await db
      .from('individual_subscriptions')
      .where('dodo_subscription_id', dodoSubscriptionId)
      .first()

    if (individualSub) {
      await this.individualSubscriptionService.handleSubscriptionExpired(
        dodoSubscriptionId,
        eventId
      )
      logger.info('Individual subscription expired', {
        eventId,
        dodoSubscriptionId,
        userId: individualSub.user_id,
      })
      return
    }

    // Try group subscription
    const groupSub = await db
      .from('group_subscriptions')
      .where('dodo_subscription_id', dodoSubscriptionId)
      .first()

    if (groupSub) {
      await this.groupSubscriptionService.handleSubscriptionExpired(dodoSubscriptionId, eventId)
      logger.info('Group subscription expired', {
        eventId,
        dodoSubscriptionId,
        ownerId: groupSub.owner_user_id,
      })
      return
    }

    logger.error('Subscription not found for expiration webhook', {
      eventId,
      dodoSubscriptionId,
    })
  }

  /**
   * Handle plan change
   * Updates subscription plan type and recalculates expiry
   */
  private async handlePlanChanged(
    dodoSubscriptionId: string,
    eventId: string,
    data: any,
    trx: any
  ): Promise<void> {
    logger.info('Plan change webhook received', {
      eventId,
      dodoSubscriptionId,
      newPlan: data.new_plan,
    })
    // Plan changes are handled by service methods
    // This webhook is just for confirmation/logging
    // The actual change happens in changeSubscriptionPlan() or expandSeats()/reduceSeats()
  }

  /**
   * Route webhook event to appropriate handler based on event type
   */
  private async routeWebhookEvent(
    eventType: DodoWebhookEvent,
    data: any,
    eventId: string,
    trx: any
  ): Promise<void> {
    const subscriptionId = data.subscriptionId

    switch (eventType) {
      case 'payment.succeeded':
      case 'subscription.renewed':
        await this.handlePaymentSuccess(subscriptionId, eventId, trx)
        break

      case 'payment.failed':
        await this.handlePaymentFailure(subscriptionId, eventId, trx)
        break

      case 'subscription.active':
        await this.handleSubscriptionActive(subscriptionId, eventId, trx)
        break

      case 'subscription.cancelled':
        await this.handleSubscriptionCancelled(subscriptionId, eventId, trx)
        break

      case 'subscription.expired':
        await this.handleSubscriptionExpired(subscriptionId, eventId, trx)
        break

      case 'subscription.plan_changed':
        await this.handlePlanChanged(subscriptionId, eventId, data, trx)
        break

      default:
        logger.warn('Unhandled webhook event type', { eventType, subscriptionId })
    }
  }

  /**
   * Check if webhook event has already been processed
   */
  async isEventProcessed(eventId: string): Promise<boolean> {
    const event = await WebhookEvent.query().where('event_id', eventId).first()
    return !!event
  }

  /**
   * Main webhook processing entry point
   * Handles idempotency check and routes to appropriate handler
   */
  async processWebhook(payload: DodoWebhookPayload): Promise<void> {
    const { eventId, eventType, createdAt, data } = payload

    logger.info('Processing webhook event', {
      eventId,
      eventType,
      resourceId: data.subscription_id,
    })

    //1. Check if there is similar existing processed webhook
    const existingEvent = await WebhookEvent.query().where('event_id', eventId).first()
    if (existingEvent) {
      logger.info('Webhook already processed, skipping', {
        eventId,
        processedAt: existingEvent.processedAt.toISO(),
      })
      return
    }

    await db.transaction(async (trx) => {
      // 2. Mark event as processed FIRST (prevents duplicate processing)
      await WebhookEvent.create(
        {
          eventId,
          eventType,
          resourceId: data.subscription_id,
          processedAt: DateTime.now(),
        },
        { client: trx }
      )

      // route to its handler
      await this.routeWebhookEvent(eventType, data, eventId, trx)
    })

    logger.info('Webhook processed successfully', {
      eventId,
      eventType,
    })
  }

  /**
   * Verify webhook signature from Dodo Payments
   * Ensures webhook is authentic and not spoofed
   */
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    // TODO: Implement signature verification based on Dodo's documentation
    // Typically HMAC-SHA256 of payload with webhook secret

    // For now, placeholder implementation

    const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex')

    const isValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))

    if (!isValid) {
      logger.warn('Invalid webhook signature', {
        receivedSignature: signature.substring(0, 10) + '...',
      })
    }

    return isValid
  }
}
