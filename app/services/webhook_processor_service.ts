import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import WebhookEvent from '#models/webhook_event'
import IndividualSubscriptionService from './individual_subscription_service.js'
import { GroupSubscriptionService } from './group_subscription_service.js'
import IndividualSubscription from '#models/individual_subscription'
import GroupSubscription from '#models/group_subscription'
import MissingSubscriptionFieldsException from '#exceptions/payment_errors_exception'
import { resolvePlanType } from '../helpers/utils.js'

@inject()
export class WebhookService {
  constructor(
    protected individualSubscriptionService: IndividualSubscriptionService,
    protected groupSubscriptionService: GroupSubscriptionService
  ) {}

  private async identifySubscriptionType(
    dodoSubscriptionId: string
  ): Promise<{ isIndividual: boolean; isGroup: boolean }> {
    const [isIndividual, isGroup] = await Promise.all([
      IndividualSubscription.query().where('dodo_subscription_id', dodoSubscriptionId).first(),
      GroupSubscription.query().where('dodo_subscription_id', dodoSubscriptionId).first(),
    ])

    return {
      isIndividual: !!isIndividual,
      isGroup: !!isGroup,
    }
  }

  private async handleSubscriptionActive(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload
    const subscriptionId = payload.subscription_id
    const expiresAt = payload.expires_at

    if (!subscriptionId || !expiresAt) {
      throw new MissingSubscriptionFieldsException()
    }

    const { isIndividual, isGroup } = await this.identifySubscriptionType(subscriptionId)

    await db.transaction(async (trx) => {
      if (isIndividual) {
        await this.individualSubscriptionService.handleSubscriptionActive(
          subscriptionId,
          expiresAt,
          trx
        )
      } else if (isGroup) {
        await this.groupSubscriptionService.handleSubscriptionActive(subscriptionId, expiresAt, trx)
      } else {
        throw new MissingSubscriptionFieldsException(`Susbrciption not found ${subscriptionId}`)
      }
    })
  }

  private async handleSubscriptionRenewed(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload
    const subscriptionId = payload.subscription_id
    const newExpiresAt = payload.expires_at

    if (!subscriptionId || !newExpiresAt) {
      throw new MissingSubscriptionFieldsException()
    }

    const { isIndividual, isGroup } = await this.identifySubscriptionType(subscriptionId)

    await db.transaction(async (trx) => {
      if (isIndividual) {
        await this.individualSubscriptionService.handleSubscriptionRenewed(
          subscriptionId,
          newExpiresAt,
          trx
        )
      } else if (isGroup) {
        await this.groupSubscriptionService.handleSubscriptionRenewed(
          subscriptionId,
          newExpiresAt,
          trx
        )
      } else {
        throw new MissingSubscriptionFieldsException(`Susbrciption not found ${subscriptionId}`)
      }
    })
  }

  private async handleSubscriptionCancelled(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload
    const subscriptionId = payload.subscription_id

    if (!subscriptionId) {
      throw new MissingSubscriptionFieldsException(`Missing required field: ${subscriptionId}`)
    }

    const { isIndividual, isGroup } = await this.identifySubscriptionType(subscriptionId)

    await db.transaction(async (trx) => {
      if (isIndividual) {
        await this.individualSubscriptionService.handleSubscriptionCancelled(subscriptionId, trx)
      } else if (isGroup) {
        await this.groupSubscriptionService.handleSubscriptionCancelled(subscriptionId, trx)
      } else {
        throw new MissingSubscriptionFieldsException(`Susbrciption not found ${subscriptionId}`)
      }
    })
  }

  private async handleSubscriptionExpired(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload
    const subscriptionId = payload.subscription_id

    if (!subscriptionId) {
      throw new MissingSubscriptionFieldsException(`Missing required field: ${subscriptionId}`)
    }

    const { isIndividual, isGroup } = await this.identifySubscriptionType(subscriptionId)

    await db.transaction(async (trx) => {
      if (isIndividual) {
        await this.individualSubscriptionService.handleSubscriptionExpired(subscriptionId, trx)
      } else if (isGroup) {
        await this.groupSubscriptionService.handleSubscriptionExpired(subscriptionId, trx)
      } else {
        throw new MissingSubscriptionFieldsException(`Susbrciption not found ${subscriptionId}`)
      }
    })
  }

  private async handleSubscriptionFailed(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload
    const subscriptionId = payload.subscription_id

    if (!subscriptionId) {
      throw new MissingSubscriptionFieldsException(`Missing required field: ${subscriptionId}`)
    }

    const { isIndividual, isGroup } = await this.identifySubscriptionType(subscriptionId)

    await db.transaction(async (trx) => {
      if (isIndividual) {
        await this.individualSubscriptionService.handleSubscriptionFailed(subscriptionId, trx)
      } else if (isGroup) {
        await this.groupSubscriptionService.handleSubscriptionFailed(subscriptionId, trx)
      } else {
        throw new MissingSubscriptionFieldsException(`Subscription not found ${subscriptionId}`)
      }
    })
  }

  private async handleSubscriptionPlanChanged(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload
    const subscriptionId = payload.subscription_id
    const newQuantity = payload.addons[0].quantity

    if (!subscriptionId) {
      throw new MissingSubscriptionFieldsException('Missing required field: subscriptionId')
    }

    await GroupSubscription.query().where('dodo_subscription_id', subscriptionId).firstOrFail()

    const planType = resolvePlanType(
      payload.payment_frequency_count,
      payload.payment_frequency_interval
    )
    await db.transaction(async (trx) => {
      await this.groupSubscriptionService.handleSubscriptionPlanChanged(
        subscriptionId,
        newQuantity,
        planType,
        trx
      )
    })
  }

  /**
   * Process a webhook event
   * Routes to appropriate handler based on event type
   */
  async processWebhookEvent(webhookEvent: WebhookEvent): Promise<void> {
    logger.info('Processing webhook event', {
      eventId: webhookEvent.eventId,
      eventType: webhookEvent.eventType,
    })

    switch (webhookEvent.eventType) {
      case 'subscription.active':
        await this.handleSubscriptionActive(webhookEvent)
        break

      case 'subscription.renewed':
        await this.handleSubscriptionRenewed(webhookEvent)
        break

      case 'subscription.cancelled':
        await this.handleSubscriptionCancelled(webhookEvent)
        break

      case 'subscription.expired':
        await this.handleSubscriptionExpired(webhookEvent)
        break

      case 'subscription.failed':
        await this.handleSubscriptionFailed(webhookEvent)
        break

      case 'subscription.plan_changed':
        await this.handleSubscriptionPlanChanged(webhookEvent)
        break

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
