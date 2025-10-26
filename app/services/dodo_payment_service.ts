import DodoPayments from 'dodopayments'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import type {
  SubscriptionCreateParams,
  SubscriptionCreateResponse,
  AddonCartResponseItem,
  TimeInterval,
  AttachAddon,
} from 'dodopayments/resources/subscriptions.mjs'
import type { BillingAddress, CustomerLimitedDetails } from 'dodopayments/resources/payments.mjs'
import type { Currency } from 'dodopayments/resources/misc.mjs'

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

export class DodoPaymentService {
  private client: DodoPayments

  constructor() {
    this.client = new DodoPayments({
      bearerToken: env.get('DODO_PAYMENTS_API_KEY'),
      environment: 'test_mode',

      maxRetries: 3,
    })
  }

  /**
   * Create a new Individual Subscription
   * @param params - typed using types from Dodo Payments Nodejs SDK.
   * @param customerEmail - From the user passed to the customer object in the params object.
   * @param customerName - From the user passed to the customer object in the params object.
   * @return Payment link and subscription details
   */
  async createIndividualSubscription(
    params: SubscriptionCreateParams,
    customerEmail: string,
    customerName: string
  ): Promise<SubscriptionCreateResponse> {
    const response = await this.client.subscriptions.create({
      product_id: params.product_id,
      quantity: params.quantity,
      customer: { email: customerEmail, name: customerName },
      billing: {
        city: params.billing.city,
        country: params.billing.country,
        state: params.billing.state,
        street: params.billing.street,
        zipcode: params.billing.zipcode,
      },
      metadata: params.metadata || {},
    })

    logger.info('Dodo subscription created successfully', {
      subscriptionId: response.subscription_id,
      paymentId: response.payment_id,
    })

    return {
      client_secret: response.client_secret,
      customer: {
        customer_id: response.customer.customer_id,
        email: response.customer.email,
        name: response.customer.name,
      },
      metadata: response.metadata,
      payment_id: response.payment_id,
      payment_link: response.payment_link,
      recurring_pre_tax_amount: response.recurring_pre_tax_amount,
      subscription_id: response.subscription_id,
      addons: response.addons,
      expires_on: response.expires_on,
    }
  }

  /**
   * Create a new Group Subscription
   * @param params - typed using types from Dodo Payments Nodejs SDK.
   * @param customerEmail - From the user passed to the customer object in the params object.
   * @param customerName - From the user passed to the customer object in the params object.
   * @returns Payment link and subscription details
   */
  async createGroupSubscription(
    params: SubscriptionCreateParams,
    customerEmail: string,
    addonId: string,
    seatCount: number,
    customerName: string
  ): Promise<SubscriptionCreateResponse> {
    const response = await this.client.subscriptions.create({
      product_id: params.product_id,
      quantity: params.quantity,
      customer: { email: customerEmail, name: customerName },
      billing: {
        city: params.billing.city,
        country: params.billing.country,
        state: params.billing.state,
        street: params.billing.street,
        zipcode: params.billing.zipcode,
      },
      metadata: params.metadata || {},
      addons: [{ addon_id: addonId, quantity: seatCount }],
    })

    logger.info('Dodo subscription created successfully', {
      subscriptionId: response.subscription_id,
      paymentId: response.payment_id,
    })

    return {
      client_secret: response.client_secret,
      customer: {
        customer_id: response.customer.customer_id,
        email: response.customer.email,
        name: response.customer.name,
      },
      metadata: response.metadata,
      payment_id: response.payment_id,
      payment_link: response.payment_link,
      recurring_pre_tax_amount: response.recurring_pre_tax_amount,
      subscription_id: response.subscription_id,
      addons: response.addons,
      expires_on: response.expires_on,
    }
  }

  /**
   * Get detailed information about a specific subscription.
   */
  async retrieveSubscription(
    dodoSubscriptionId: string
  ): Promise<Partial<SubscriptionsDetailsRetrieveResponse>> {
    const subscription = await this.client.subscriptions.retrieve(dodoSubscriptionId)

    return {
      addons: subscription.addons,
      subscription_id: subscription.subscription_id,
      product_id: subscription.product_id,
      quantity: subscription.quantity,
      status: subscription.status,
      currency: subscription.currency,
      recurring_pre_tax_amount: subscription.recurring_pre_tax_amount,
      next_billing_date: subscription.next_billing_date,
      previous_billing_date: subscription.previous_billing_date,
      created_at: subscription.created_at,
      cancel_at_next_billing_date: subscription.cancel_at_next_billing_date,
      cancelled_at: subscription.cancelled_at,
      customer: {
        customer_id: subscription.customer.customer_id,
        email: subscription.customer.email,
        name: subscription.customer.name,
      },
      billing: subscription.billing,
      metadata: subscription.metadata,
    }
  }

  /**
   * Update subscription details (billing, metadata, etc.)
   * @params newBillingParams typed as the BillingAddress from dodo Payments.
   * @params dodoSubscriptionId
   * Use it to update billing address.
   */
  async updateSubscriptionBillingAddress(
    dodoSubscriptionId: string,
    newBillingParams?: BillingAddress
  ): Promise<Partial<SubscriptionsDetailsRetrieveResponse>> {
    const subscription = await this.client.subscriptions.update(dodoSubscriptionId, {
      billing: newBillingParams,
    })

    logger.info('Subscription updated', { dodoSubscriptionId, newBillingParams })

    return {
      addons: subscription.addons,
      subscription_id: subscription.subscription_id,
      product_id: subscription.product_id,
      quantity: subscription.quantity,
      status: subscription.status,
      recurring_pre_tax_amount: subscription.recurring_pre_tax_amount,
      next_billing_date: subscription.next_billing_date,
      previous_billing_date: subscription.previous_billing_date,
      created_at: subscription.created_at,
      cancel_at_next_billing_date: subscription.cancel_at_next_billing_date,
      cancelled_at: subscription.cancelled_at,
      customer: {
        customer_id: subscription.customer.customer_id,
        email: subscription.customer.email,
        name: subscription.customer.name,
      },
      billing: newBillingParams,
      metadata: subscription.metadata,
    }
  }

  /**
   * Cancels the active subscription
   * @params cancelAtPeriodEnd: boolean = true
   * @params dodoSubscriptionId
   * Use it to cancel the current active subscription when it ends.
   */

  async cancelSubscription(
    subscriptionId: string,
    cancelAtPeriodEnd: boolean = true
  ): Promise<Partial<SubscriptionsDetailsRetrieveResponse>> {
    const subscription = await this.client.subscriptions.update(subscriptionId, {
      cancel_at_next_billing_date: cancelAtPeriodEnd,
      status: cancelAtPeriodEnd ? 'active' : 'cancelled',
    })

    logger.info('Subscription cancelled', { subscriptionId, cancelAtPeriodEnd })
    return {
      addons: subscription.addons,
      subscription_id: subscription.subscription_id,
      product_id: subscription.product_id,
      quantity: subscription.quantity,
      status: subscription.status,
      recurring_pre_tax_amount: subscription.recurring_pre_tax_amount,
      next_billing_date: subscription.next_billing_date,
      previous_billing_date: subscription.previous_billing_date,
      created_at: subscription.created_at,
      cancel_at_next_billing_date: subscription.cancel_at_next_billing_date,
      cancelled_at: subscription.cancelled_at,
      customer: {
        customer_id: subscription.customer.customer_id,
        email: subscription.customer.email,
        name: subscription.customer.name,
      },
      billing: subscription.billing,
      metadata: subscription.metadata,
    }
  }

  /**
   * Change from current plan to one of monthly, or quarterly, or annual plans for an Individual Subscription
   * @param params - is an object with the following properties :-
   * @property newProduct,
   * @property quantity which is always 1 since you can only have one active subscription,
   * @property prorationBillingMode can either be 'prorated_immediately' | 'full_immediately' | 'difference_immediately' as from dodo payments, and @property of type AttachAddon[] from dodo payments types.
   *
   * @return a success message string on success or error for an error(done at controller level)
   */

  async changeIndividualSubscriptionPlan(
    dodoSubscriptionId: string,
    params: {
      newProductId: string
      quantity: number
      prorationBillingMode: 'prorated_immediately'
      addons?: AttachAddon[]
    }
  ) {
    await this.client.subscriptions.changePlan(dodoSubscriptionId, {
      product_id: params.newProductId,
      quantity: params.quantity,
      proration_billing_mode: params.prorationBillingMode,
    })

    logger.info('Subscription plan changed', {
      subscriptionId: dodoSubscriptionId,
      newProductId: params.newProductId,
    })
    return 'Subscription plan changed'
  }
}
