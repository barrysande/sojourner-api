import DodoPayments from 'dodopayments'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import type { CountryCode } from 'dodopayments/resources/misc.mjs'

export class DodoPaymentService {
  private client: DodoPayments

  constructor() {
    this.client = new DodoPayments({
      bearerToken: env.get('DODO_PAYMENTS_API_KEY'),
      environment: 'test_mode',

      maxRetries: 3,
    })
  }

  async createSubscription(params: {
    productId: string
    customerId: string
    email: string
    name: string
    quantity: number
    billing: {
      city: string
      country: CountryCode
      state: string
      street: string
      zipcode: string
    }
    metadata?: Record<string, any>
  }) {
    try {
      const subscription = await this.client.subscriptions.create({
        product_id: params.productId,
        quantity: params.quantity,
        customer: {
          customer_id: params.customerId,
        },
        billing: {
          city: params.billing.city,
          country: params.billing.country,
          state: params.billing.state,
          street: params.billing.street,
          zipcode: params.billing.zipcode,
        },
        metadata: params.metadata,
      })

      logger.info('Subscription created', {
        subscriptionId: subscription.subscription_id,
        customerId: params.customerId,
      })
    } catch (error) {
      logger.error('Failed to create subscription', { error, params })
      throw error
    }
  }

  /**
   * Get detailed information about a specific subscription.
   */
  async getSubscription(subscriptionId: string) {
    try {
      return await this.client.subscriptions.retrieve(subscriptionId)
    } catch (error) {
      logger.error('Failed to retrieve subscription', { error, subscriptionId })
      throw error
    }
  }

  async updateSubscription(
    subscriptionId: string,
    params: {
      status?: 'pending' | 'active' | 'on_hold' | 'cancelled' | 'failed' | 'expired'
      cancelAtNextBillingDate?: boolean
      metadata?: Record<string, any>
    }
  ) {
    try {
      const subscription = await this.client.subscriptions.update(subscriptionId, params)

      logger.info('Subscription updated', { subscriptionId, params })

      return subscription
    } catch (error) {
      logger.error('Failed to update subscription', { error, subscriptionId, params })
      throw error
    }
  }

  async cancelSubscription(subscriptionId: string, cancelAtPeriodEnd: boolean = true) {
    try {
      const subscription = await this.client.subscriptions.update(subscriptionId, {
        cancel_at_next_billing_date: cancelAtPeriodEnd,
        status: cancelAtPeriodEnd ? 'active' : 'cancelled',
      })

      logger.info('Subscription cancelled', { subscriptionId, cancelAtPeriodEnd })
      return subscription
    } catch (error) {
      logger.error('Failed to cancel subscription', { error, subscriptionId })
      throw error
    }
  }

  async changeSubscriptionPlan(params: {
    subscriptionId: string
    newProductId: string
    quantity: number
    prorationBillingMode: 'prorated_immediately' | 'full_immediately' | 'difference_immediately'
  }) {
    try {
      const subscription = await this.client.subscriptions.changePlan(params.subscriptionId, {
        product_id: params.newProductId,
        quantity: params.quantity,
        proration_billing_mode: params.prorationBillingMode,
      })

      logger.info('Subscription plan changed', {
        subscriptionId: params.subscriptionId,
        newProductId: params.newProductId,
      })
      return subscription
    } catch (error) {
      logger.error('Failed to change subscription plan', { error, params })
      throw error
    }
  }

  /**
   * Get a list of all subscriptions associated with your account.
   */
  async listCustomerSubscriptions(customerId: string) {
    try {
      return await this.client.subscriptions.list({ customer_id: customerId, page_size: 100 })
    } catch (error) {
      logger.error('Failed to list customer subscriptions', { error, customerId })
      throw error
    }
  }
}
