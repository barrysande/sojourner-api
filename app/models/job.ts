import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type QueueName = 'webhooks' | 'emails'

export interface WebhookJobPayload {
  eventId: number
}

export interface EmailJobPayload {
  userId: number
  emailType: 'email_verification' | 'password_reset'
  metadata?: Record<string, any>
}

export type JobPayload = WebhookJobPayload | EmailJobPayload

export default class Job extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare queueName: QueueName

  @column()
  declare payload: JobPayload

  @column()
  declare status: JobStatus

  @column()
  declare priority: number

  @column()
  declare attempts: number

  @column()
  declare lastError: string | null

  @column.dateTime()
  declare scheduledFor: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
