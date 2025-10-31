import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import WebhookEvent from '#models/webhook_event'
import { IndividualSubscriptionService } from './individual_subscription_service.js'
import { GroupSubscriptionService } from './group_subscription_service.js'
import crypto from 'node:crypto'
import IndividualSubscription from '#models/individual_subscription'
import GroupSubscription from '#models/group_subscription'

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
}
