import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import WebhookEvent from '#models/webhook_event'
import { IndividualSubscriptionService } from './individual_subscription_service.js'
import { GroupSubscriptionService } from './group_subscription_service.js'
import IndividualSubscription from '#models/individual_subscription'
import GroupSubscription from '#models/group_subscription'
import MissingSubscriptionFieldsException from '#exceptions/payment_errors_exception'
import type { WebhookEventType } from 'dodopayments/resources/index.mjs'
import type { SubscriptionWebhookPayload } from '../../types/webhook.js'

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
    const expiresAt = DateTime.fromISO(payload.expires_at as string)

    if (!subscriptionId || expiresAt) {
      throw new MissingSubscriptionFieldsException()
    }

    const { isIndividual, isGroup } = await this.identifySubscriptionType(subscriptionId)

    await db.transaction(async (trx) => {
      if (isIndividual) {
      }
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

    try {
      switch (webhookEvent.eventType) {
      }
    } catch (error) {}
  }
}
