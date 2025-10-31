import type { Subscription } from 'dodopayments/resources/subscriptions.mjs'
export interface WebhookEventData {
  created_at: string
  payload_type: 'Subscription' | 'Refund' | 'Dispute' | 'LicenseKey'
  [key: string]: any
}

export interface SubscriptionWebhookPayload extends WebhookEventData, Subscription {
  payload_type: 'Subscription'
}
