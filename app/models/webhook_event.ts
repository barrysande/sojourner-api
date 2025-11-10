import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { WebhookEventType } from 'dodopayments/resources/webhook-events.mjs'
import type { SubscriptionWebhookPayload } from '../../types/webhook.js'
import type { WebhookEventStatus } from '../../types/webhook.js'

export default class WebhookEvent extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare eventId: string

  @column()
  declare eventType: WebhookEventType

  @column()
  declare businessId: string

  @column()
  declare payload: SubscriptionWebhookPayload

  @column()
  declare status: WebhookEventStatus

  @column()
  declare attempts: number

  @column()
  declare lastError: string | null

  @column.dateTime()
  declare processedAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
