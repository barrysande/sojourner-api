import type {
  Subscription,
  AddonCartResponseItem,
  TimeInterval,
} from 'dodopayments/resources/subscriptions.mjs'
import { Currency, CountryCode } from 'dodopayments/resources/misc.mjs'
import type { AttachAddon } from 'dodopayments/resources/subscriptions.mjs'
import type { BillingAddress, CustomerLimitedDetails } from 'dodopayments/resources/payments.mjs'

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
  confirm: boolean
  metadata?: Record<string, any>
  returnUrl?: string
  paymentLink?: boolean
  trialPeriodDays?: number
}

export interface SubscriptionCreateResponse {
  checkoutUrl: string
  sessionId: string
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
  previous_billing_date: string
  product_id: string
  quantity: number
  recurring_pre_tax_amount: number
  status: SubscriptionStatus
  subscription_id: string
  subscription_period_count: number
  subscription_period_interval: TimeInterval
  tax_id: string | null
  tax_inclusive: boolean
  trial_period_days: number
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

export type WebhookEventStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface WebhookEventData {
  created_at: string
  payload_type: 'Subscription' | 'Refund' | 'Dispute' | 'LicenseKey'
  [key: string]: any
}

export interface SubscriptionWebhookPayload extends WebhookEventData, Subscription {
  payload_type: 'Subscription'
}

export type PlanType = 'monthly' | 'quarterly' | 'annual'

export type PaymentFrequencyInterval = 'Day' | 'Week' | 'Month' | 'Year'
export type PriceDetail = RecurringPriceDetail | OneTimePriceDetail

export type TaxCategory = 'saas' | 'digital_products' | 'e_book' | 'edtech'

export type SubscriptionFrequencyInterval = 'Day' | 'Week' | 'Month' | 'Year'

export interface RecurringPriceDetail {
  type: 'recurring_price'
  currency: Currency
  price: number
  discount: number
  payment_frequency_count: number
  payment_frequency_interval: SubscriptionFrequencyInterval
  subscription_period_count: number
  subscription_period_interval: SubscriptionFrequencyInterval
  purchasing_power_parity: boolean
  tax_inclusive: boolean | null
  trial_period_days: number
}

export interface OneTimePriceDetail {
  type: 'one_time_price'
  currency: Currency
  price: number
  tax_inclusive: boolean | null
}

export interface ProductPriceDetails {
  currency: Currency
  discount: number
  payment_frequency_count: number
  payment_frequency_interval: SubscriptionFrequencyInterval
  price: number
  purchasing_power_parity: boolean
  subscription_period_count: number
  subscription_period_interval: SubscriptionFrequencyInterval
  type: 'recurring_price'
  tax_inclusive: boolean | null
  trial_period_days: number
}

export interface LicenseKeyDuration {
  count: number
  interval: SubscriptionFrequencyInterval
}

export interface DigitalProductDeliveryFile {
  file_id: string
  file_name: string
  url: string
}

export interface DigitalProductDelivery {
  external_url: string | null
  files: DigitalProductDeliveryFile[] | null
  instructions: string | null
}

export interface DodoProductWithDetails {
  brand_id: string
  business_id: string
  created_at: string
  is_recurring: boolean
  license_key_enabled: boolean
  metadata: Record<string, unknown>
  price: ProductPriceDetails
  product_id: string
  tax_category: TaxCategory
  updated_at: string
  addons: string[]
  description: string | null
  digital_product_delivery: DigitalProductDelivery | null
  image: string | null
  license_key_activation_message: string | null
  license_key_activations_limit: number | null
  license_key_duration: LicenseKeyDuration | null
  name: string
}
