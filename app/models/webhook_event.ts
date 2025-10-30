import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { WebhookEventType } from 'dodopayments/resources/webhook-events.mjs'

export type WebhookEventStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface DodoWebhookPayload {
  business_id: string
  type: WebhookEventType
  timestamp: string
  data: Record<string, any>
}

export default class WebhookEvent extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare eventId: string

  @column()
  declare eventType: string

  @column()
  declare resourceId: string //subscription_id extract from payload.data.subscription_id

  @column()
  declare payload: DodoWebhookPayload

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
