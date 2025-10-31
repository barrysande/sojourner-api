import type {
  Subscription,
  AddonCartResponseItem,
  TimeInterval,
} from 'dodopayments/resources/subscriptions.mjs'
import { Currency, CountryCode } from 'dodopayments/resources/misc.mjs'
import type { AttachAddon } from 'dodopayments/resources/subscriptions.mjs'
import type { BillingAddress, CustomerLimitedDetails } from 'dodopayments/resources/payments.mjs'

export interface WebhookEventData {
  created_at: string
  payload_type: 'Subscription' | 'Refund' | 'Dispute' | 'LicenseKey'
  [key: string]: any
}

export interface SubscriptionWebhookPayload extends WebhookEventData, Subscription {
  payload_type: 'Subscription'
}

export interface MeterRaw {
  currency: Currency
  description: string | null
  free_threshold: number
  measurement_unit: string
  meter_id: string
  name: string
  price_per_unit: string
}

export type SubscriptionStatus =
  | 'pending'
  | 'active'
  | 'on_hold'
  | 'cancelled'
  | 'failed'
  | 'expired'

export interface CreateIndividualSubscriptionParams {
  productId: string
  quantity: number
  customer: {
    email: string
    name?: string
    phoneNumber?: string
  }
  billing: {
    street: string
    city: string
    state: string
    zipcode: string
    country: CountryCode
  }
  metadata?: Record<string, any>
  returnUrl?: string
  paymentLink?: boolean
  trialPeriodDays?: number
}

export interface CreateGroupSubscriptionParams {
  productId: string
  quantity: number
  customer: {
    email: string
    name?: string
    phoneNumber?: string
  }
  billing: {
    street: string
    city: string
    state: string
    zipcode: string
    country: CountryCode
  }
  metadata?: Record<string, any>
  addons: AttachAddon[]
  returnUrl?: string
  paymentLink?: boolean
  trialPeriodDays?: number
}

export interface SubscriptionsDetailsRetrieveResponse {
  addons: AddonCartResponseItem[]
  billing: BillingAddress
  cancel_at_next_billing_date: boolean
  cancelled_at: string | null | undefined
  created_at: string
  currency: Currency
  customer: CustomerLimitedDetails
  discount_cycles_remaining: number | null
  discount_id: string | null
  expires_at: string | null
  metadata: Record<string, any>
  meters: MeterRaw[]
  next_billing_date: string | null
  on_demand: boolean
  payment_frequency_count: number
  payment_frequency_interval: TimeInterval
  previous_billing_date: string | null
  product_id: string
  quantity: number
  recurring_pre_tax_amount: number
  status: SubscriptionStatus
  subscription_id: string
  subscription_period_count: number
  subscription_period_interval: TimeInterval
  tax_id: string | null
  tax_inclusive: boolean
  trial_period_days: number | null
}

export interface ChangeIndividualSubscriptionPlanParams {
  newProductId: string
  quantity: number
  prorationBillingMode: 'prorated_immediately'
}

export interface ChangeGroupSubscriptionPlanParams {
  newProductId: string
  quantity: number
  prorationBillingMode: 'prorated_immediately'
  addons: AttachAddon[]
}
