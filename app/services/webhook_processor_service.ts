import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import User from '#models/user'
import WebhookEvent from '#models/webhook_event'
import IndividualSubscriptionService from './individual_subscription_service.js'
import { GroupSubscriptionService } from './group_subscription_service.js'
import IndividualSubscription from '#models/individual_subscription'
import GroupSubscription from '#models/group_subscription'
import { MissingSubscriptionFieldsException } from '#exceptions/payment_errors_exception'
import { resolvePlanType } from '../helpers/utils.js'

@inject()
export default class WebhookService {
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

  private async handleSubscriptionActive(webhookEvent: WebhookEvent): Promise<User> {
    const payload = webhookEvent.payload
    const subscriptionId = payload.subscription_id
    const expiresAt = payload.expires_at

    if (!subscriptionId || !expiresAt) {
      throw new MissingSubscriptionFieldsException()
    }

    const { isIndividual, isGroup } = await this.identifySubscriptionType(subscriptionId)

    const user = await db.transaction(async (trx) => {
      if (isIndividual) {
        return await this.individualSubscriptionService.handleSubscriptionActive(
          subscriptionId,
          expiresAt,
          trx
        )
      } else if (isGroup) {
        return await this.groupSubscriptionService.handleSubscriptionActive(
          subscriptionId,
          expiresAt,
          trx
        )
      } else {
        throw new MissingSubscriptionFieldsException(`Susbrciption not found ${subscriptionId}`)
      }
    })

    return user
  }

  private async handleSubscriptionRenewed(webhookEvent: WebhookEvent): Promise<User> {
    const payload = webhookEvent.payload
    const subscriptionId = payload.subscription_id
    const newExpiresAt = payload.expires_at

    if (!subscriptionId || !newExpiresAt) {
      throw new MissingSubscriptionFieldsException()
    }

    const { isIndividual, isGroup } = await this.identifySubscriptionType(subscriptionId)

    const user = await db.transaction(async (trx) => {
      if (isIndividual) {
        return await this.individualSubscriptionService.handleSubscriptionRenewed(
          subscriptionId,
          newExpiresAt,
          trx
        )
      } else if (isGroup) {
        return await this.groupSubscriptionService.handleSubscriptionRenewed(
          subscriptionId,
          newExpiresAt,
          trx
        )
      } else {
        throw new MissingSubscriptionFieldsException(`Susbrciption not found ${subscriptionId}`)
      }
    })

    return user
  }

  private async handleSubscriptionCancelled(webhookEvent: WebhookEvent): Promise<User> {
    const payload = webhookEvent.payload
    const subscriptionId = payload.subscription_id

    if (!subscriptionId) {
      throw new MissingSubscriptionFieldsException(`Missing required field: ${subscriptionId}`)
    }

    const { isIndividual, isGroup } = await this.identifySubscriptionType(subscriptionId)

    const user = await db.transaction(async (trx) => {
      if (isIndividual) {
        return await this.individualSubscriptionService.handleSubscriptionCancelled(
          subscriptionId,
          trx
        )
      } else if (isGroup) {
        return await this.groupSubscriptionService.handleSubscriptionCancelled(subscriptionId, trx)
      } else {
        throw new MissingSubscriptionFieldsException(`Susbrciption not found ${subscriptionId}`)
      }
    })

    return user
  }

  private async handleSubscriptionExpired(webhookEvent: WebhookEvent): Promise<User> {
    const payload = webhookEvent.payload
    const subscriptionId = payload.subscription_id

    if (!subscriptionId) {
      throw new MissingSubscriptionFieldsException(`Missing required field: ${subscriptionId}`)
    }

    const { isIndividual, isGroup } = await this.identifySubscriptionType(subscriptionId)

    const user = await db.transaction(async (trx) => {
      if (isIndividual) {
        return await this.individualSubscriptionService.handleSubscriptionExpired(
          subscriptionId,
          trx
        )
      } else if (isGroup) {
        return await this.groupSubscriptionService.handleSubscriptionExpired(subscriptionId, trx)
      } else {
        throw new MissingSubscriptionFieldsException(`Susbrciption not found ${subscriptionId}`)
      }
    })

    return user
  }

  private async handleSubscriptionFailed(webhookEvent: WebhookEvent): Promise<User> {
    const payload = webhookEvent.payload
    const subscriptionId = payload.subscription_id

    if (!subscriptionId) {
      throw new MissingSubscriptionFieldsException(`Missing required field: ${subscriptionId}`)
    }

    const { isIndividual, isGroup } = await this.identifySubscriptionType(subscriptionId)

    const user = await db.transaction(async (trx) => {
      if (isIndividual) {
        return await this.individualSubscriptionService.handleSubscriptionFailed(
          subscriptionId,
          trx
        )
      } else if (isGroup) {
        return await this.groupSubscriptionService.handleSubscriptionFailed(subscriptionId, trx)
      } else {
        throw new MissingSubscriptionFieldsException(`Subscription not found ${subscriptionId}`)
      }
    })

    return user
  }

  private async handleSubscriptionPlanChanged(webhookEvent: WebhookEvent): Promise<User> {
    const payload = webhookEvent.payload
    const subscriptionId = payload.subscription_id
    const newQuantity = payload.addons[0].quantity

    if (!subscriptionId) {
      throw new MissingSubscriptionFieldsException('Missing required field: subscriptionId')
    }

    const { isIndividual, isGroup } = await this.identifySubscriptionType(subscriptionId)

    // await GroupSubscription.query().where('dodo_subscription_id', subscriptionId).firstOrFail()

    const planType = resolvePlanType(
      payload.payment_frequency_count,
      payload.payment_frequency_interval
    )
    const user = await db.transaction(async (trx) => {
      if (isIndividual) {
        return await this.individualSubscriptionService.handleSubscriptionPlanChanged(
          subscriptionId,
          planType,
          payload.expires_at!,
          trx
        )
      } else if (isGroup) {
        return await this.groupSubscriptionService.handleSubscriptionPlanChanged(
          subscriptionId,
          newQuantity,
          planType,
          trx
        )
      } else {
        throw new MissingSubscriptionFieldsException(`Subscription not found ${subscriptionId}`)
      }
    })

    return user
  }

  /**
   * Process a webhook event
   * Routes to appropriate handler based on event type
   */
  async processWebhookEvent(webhookEvent: WebhookEvent): Promise<User | void> {
    logger.info('Processing webhook event', {
      eventId: webhookEvent.eventId,
      eventType: webhookEvent.eventType,
    })

    let user: User | void

    switch (webhookEvent.eventType) {
      case 'subscription.active':
        user = await this.handleSubscriptionActive(webhookEvent)
        break

      case 'subscription.renewed':
        user = await this.handleSubscriptionRenewed(webhookEvent)
        break

      case 'subscription.cancelled':
        user = await this.handleSubscriptionCancelled(webhookEvent)
        break

      case 'subscription.expired':
        user = await this.handleSubscriptionExpired(webhookEvent)
        break

      case 'subscription.failed':
        user = await this.handleSubscriptionFailed(webhookEvent)
        break

      case 'subscription.plan_changed':
        user = await this.handleSubscriptionPlanChanged(webhookEvent)
        break

      default:
        logger.warn('Unknown webhook event type', {
          eventId: webhookEvent.eventId,
          eventType: webhookEvent.eventType,
        })
        user = undefined
    }

    logger.info('Webhook event processed successfully', {
      eventId: webhookEvent.eventId,
      eventType: webhookEvent.eventType,
    })

    return user
  }
}
