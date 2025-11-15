import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import User from '#models/user'
import WebhookEvent from '#models/webhook_event'
import IndividualSubscriptionService from './individual_subscription_service.js'
import { GroupSubscriptionService } from './group_subscription_service.js'
import IndividualSubscription from '#models/individual_subscription'
import GroupSubscriptionMember from '#models/group_subscription_member'
import GroupSubscription from '#models/group_subscription'
import { MissingSubscriptionFieldsException } from '#exceptions/payment_errors_exception'
import { resolvePlanType } from '../helpers/utils.js'
import { Exception } from '@adonisjs/core/exceptions'
import { DateTime } from 'luxon'

@inject()
export default class WebhookService {
  constructor(
    protected individualSubscriptionService: IndividualSubscriptionService,
    protected groupSubscriptionService: GroupSubscriptionService
  ) {}

  /**
   * This is the new "self-healing" handler for 'subscription.active'.
   * It contains the critical "check-or-create" logic.
   */
  private async handleSubscriptionActive(webhookEvent: WebhookEvent): Promise<User> {
    const payload = webhookEvent.payload
    const dodoSubId = payload.subscription_id
    const expiresAt = payload.expires_at

    if (!dodoSubId || !expiresAt) {
      throw new MissingSubscriptionFieldsException()
    }

    // Get the "source of truth" from the metadata in webhook_events table.
    const subType = payload.metadata?.subscription_type
    const userId = Number(payload.metadata?.userId)
    const ownerUserId = Number(payload.metadata?.ownerUserId)

    return db.transaction(async (trx) => {
      // Path A: Individual Subscription
      if (subType === 'individual') {
        if (!userId) {
          throw new Exception(`Missing metadata.userId for ${dodoSubId}`)
        }

        // 1. Idempotency Check
        let subscription = await IndividualSubscription.query({ client: trx })
          .where('dodoSubscriptionId', dodoSubId)
          .first()

        if (!subscription) {
          // 2. begin self-recovery incase a user pays for individual sub but for some reason my database fails to create a subscription record with pending status
          logger.warn(`ORPHAN individual subscription found. Healing now: ${dodoSubId}`)
          await IndividualSubscription.create(
            {
              userId: userId,
              dodoSubscriptionId: dodoSubId,
              planType: resolvePlanType(
                payload.payment_frequency_count,
                payload.payment_frequency_interval
              ),
              status: 'pending',
            },
            { client: trx }
          )
        }

        // 3. Activate
        return this.individualSubscriptionService.handleSubscriptionActive(
          dodoSubId,
          expiresAt,
          trx
        )
      }

      // Path B: Group Subscription
      else if (subType === 'group') {
        if (!ownerUserId) {
          throw new Exception(`Missing metadata.ownerUserId for ${dodoSubId}`)
        }

        // 1. Idemptoncy check
        let subscription = await GroupSubscription.query({ client: trx })
          .where('dodoSubscriptionId', dodoSubId)
          .first()

        if (!subscription) {
          // 2. begin self-recovery incase a user pays for group but for some reason my database fails to create a subscription record with pending status
          logger.warn(`ORPHAN group subscription found. Healing now: ${dodoSubId}`)
          const totalSeats = payload.addons?.[0]?.quantity

          const inviteCode = await this.groupSubscriptionService.generateInviteCode()
          const inviteCodeExpiresAt = this.groupSubscriptionService.calculateInviteCodeExpiry()

          subscription = await GroupSubscription.create(
            {
              ownerUserId,
              dodoSubscriptionId: dodoSubId,
              totalSeats,
              inviteCode,
              inviteCodeExpiresAt,
              status: 'pending',
              planType: resolvePlanType(
                payload.payment_frequency_count,
                payload.payment_frequency_interval
              ),
            },
            { client: trx }
          )

          // Create the owner's member record
          await GroupSubscriptionMember.create(
            {
              groupSubscriptionId: subscription.id,
              userId: ownerUserId,
              joinedAt: DateTime.now(),
              status: 'active',
            },
            { client: trx }
          )
        }

        // 3. Activate
        return this.groupSubscriptionService.handleSubscriptionActive(dodoSubId, expiresAt, trx)
      }

      // Path C ERROR
      else {
        throw new Exception(`Unknown metadata.subscription_type: '${subType}'`)
      }
    })
  }

  /**
   * All other handlers are now simpler. They trust the metadata
   * and do not need to query to identify the type.
   */
  private async handleSubscriptionRenewed(webhookEvent: WebhookEvent): Promise<User> {
    const payload = webhookEvent.payload
    const dodoSubId = payload.subscription_id
    const newExpiresAt = payload.expires_at
    const subType = payload.metadata?.subscription_type

    if (!dodoSubId || !newExpiresAt) {
      throw new MissingSubscriptionFieldsException()
    }

    return db.transaction(async (trx) => {
      if (subType === 'individual') {
        return this.individualSubscriptionService.handleSubscriptionRenewed(
          dodoSubId,
          newExpiresAt,
          trx
        )
      } else if (subType === 'group') {
        return this.groupSubscriptionService.handleSubscriptionRenewed(dodoSubId, newExpiresAt, trx)
      }
      throw new MissingSubscriptionFieldsException(`Subscription not found ${dodoSubId}`)
    })
  }

  private async handleSubscriptionCancelled(webhookEvent: WebhookEvent): Promise<User> {
    const payload = webhookEvent.payload
    const dodoSubId = payload.subscription_id
    const subType = payload.metadata?.subscription_type

    if (!dodoSubId) {
      throw new MissingSubscriptionFieldsException(`Missing required field: ${dodoSubId}`)
    }

    return db.transaction(async (trx) => {
      if (subType === 'individual') {
        return this.individualSubscriptionService.handleSubscriptionCancelled(dodoSubId, trx)
      } else if (subType === 'group') {
        return this.groupSubscriptionService.handleSubscriptionCancelled(dodoSubId, trx)
      }
      throw new MissingSubscriptionFieldsException(`Subscription not found ${dodoSubId}`)
    })
  }

  private async handleSubscriptionExpired(webhookEvent: WebhookEvent): Promise<User> {
    const payload = webhookEvent.payload
    const dodoSubId = payload.subscription_id
    const subType = payload.metadata?.subscription_type

    if (!dodoSubId) {
      throw new MissingSubscriptionFieldsException(`Missing required field: ${dodoSubId}`)
    }

    return db.transaction(async (trx) => {
      if (subType === 'individual') {
        return this.individualSubscriptionService.handleSubscriptionExpired(dodoSubId, trx)
      } else if (subType === 'group') {
        return this.groupSubscriptionService.handleSubscriptionExpired(dodoSubId, trx)
      }
      throw new MissingSubscriptionFieldsException(`Subscription not found ${dodoSubId}`)
    })
  }

  private async handleSubscriptionFailed(webhookEvent: WebhookEvent): Promise<User> {
    const payload = webhookEvent.payload
    const dodoSubId = payload.subscription_id
    const subType = payload.metadata?.subscription_type

    if (!dodoSubId) {
      throw new MissingSubscriptionFieldsException(`Missing required field: ${dodoSubId}`)
    }

    return db.transaction(async (trx) => {
      if (subType === 'individual') {
        return this.individualSubscriptionService.handleSubscriptionFailed(dodoSubId, trx)
      } else if (subType === 'group') {
        return this.groupSubscriptionService.handleSubscriptionFailed(dodoSubId, trx)
      }
      throw new MissingSubscriptionFieldsException(`Subscription not found ${dodoSubId}`)
    })
  }

  private async handleSubscriptionPlanChanged(webhookEvent: WebhookEvent): Promise<User> {
    const payload = webhookEvent.payload
    const dodoSubId = payload.subscription_id
    const subType = payload.metadata?.subscription_type
    const newQuantity = payload.addons?.[0]?.quantity

    if (!dodoSubId) {
      throw new MissingSubscriptionFieldsException('Missing required field: subscriptionId')
    }

    const planType = resolvePlanType(
      payload.payment_frequency_count,
      payload.payment_frequency_interval
    )

    return db.transaction(async (trx) => {
      if (subType === 'individual') {
        return this.individualSubscriptionService.handleSubscriptionPlanChanged(
          dodoSubId,
          planType,
          payload.expires_at!,
          trx
        )
      } else if (subType === 'group') {
        return this.groupSubscriptionService.handleSubscriptionPlanChanged(
          dodoSubId,
          newQuantity || 1, // Default to 1 if no addon quantity
          planType,
          trx
        )
      }
      throw new MissingSubscriptionFieldsException(`Subscription not found ${dodoSubId}`)
    })
  }

  /**
   * Main router for all webhook events.
   * This is called by the ProcessWebhooks command.
   */
  async processWebhookEvent(webhookEvent: WebhookEvent): Promise<User | void> {
    logger.info('Processing webhook event', {
      eventId: webhookEvent.eventId,
      eventType: webhookEvent.eventType,
    })

    // NOTE: We've removed the top-level transaction from the WORKER
    // and let each handler manage its own, because 'subscription.active'
    // has a complex "check-or-create" flow that must be atomic.
    // The worker's job is just to call this method.

    switch (webhookEvent.eventType) {
      case 'subscription.active':
        return this.handleSubscriptionActive(webhookEvent)

      case 'subscription.renewed':
        return this.handleSubscriptionRenewed(webhookEvent)

      case 'subscription.cancelled':
        return this.handleSubscriptionCancelled(webhookEvent)

      case 'subscription.expired':
        return this.handleSubscriptionExpired(webhookEvent)

      case 'subscription.failed':
      case 'subscription.on_hold': // Route 'on_hold' to the 'failed' handler
        return this.handleSubscriptionFailed(webhookEvent)

      case 'subscription.plan_changed':
        return this.handleSubscriptionPlanChanged(webhookEvent)

      default:
        logger.warn('Unknown webhook event type', {
          eventId: webhookEvent.eventId,
          eventType: webhookEvent.eventType,
        })
    }

    logger.info('Webhook event processed successfully', {
      eventId: webhookEvent.eventId,
      eventType: webhookEvent.eventType,
    })
  }
}
