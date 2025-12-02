import DodoPayments from 'dodopayments'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import type { Subscription } from 'dodopayments/resources/subscriptions.mjs'
import type { BillingAddress } from 'dodopayments/resources/payments.mjs'
import {
  SubscriptionGatewayUnavailableError,
  InvalidSubscriptionDataError,
} from '#exceptions/payment_errors_exception'
import type {
  CreateIndividualSubscriptionParams,
  CreateGroupSubscriptionParams,
  ChangeGroupSubscriptionPlanParams,
  ChangeIndividualSubscriptionPlanParams,
  SubscriptionCreateResponse,
} from '../../types/payments.js'
import IndividualSubscription from '#models/individual_subscription'
import GroupSubscription from '#models/group_subscription'
import { Exception } from '@adonisjs/core/exceptions'

export default class DodoPaymentService {
  client: DodoPayments

  constructor() {
    this.client = new DodoPayments({
      bearerToken: env.get('DODO_PAYMENTS_API_KEY'),
      environment: 'test_mode',
      webhookKey: env.get('DODO_PAYMENTS_WEBHOOK_KEY'),

      maxRetries: 3,
    })
  }

  private handleDodoApiError(error: any): never {
    const status = error.response?.status || error.status

    if (status) {
      if (status >= 400 && status < 500) {
        throw new InvalidSubscriptionDataError()
      }

      if (status >= 500) {
        throw new SubscriptionGatewayUnavailableError()
      }
    }

    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw new SubscriptionGatewayUnavailableError('Payment gateway timeout. Please try again.')
    }

    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      throw new SubscriptionGatewayUnavailableError('Could not connect to payment gateway.')
    }

    logger.error('Unexpected Dodo API error', {
      message: error?.message,
      stack: error?.stack,
      error: error,
    })
    throw new SubscriptionGatewayUnavailableError()
  }

  /**
   * Create a new Individual Subscription
   * @param params - typed using interface CreateIndividualSubscriptionParams.
   * @param customerEmail - From the user passed to the customer object in the params object.
   * @param customerName - From the user passed to the customer object in the params object.
   * @return Payment link and subscription details
   */
  async createIndividualSubscription(
    params: CreateIndividualSubscriptionParams
  ): Promise<SubscriptionCreateResponse> {
    try {
      const response = await this.client.checkoutSessions.create({
        product_cart: [
          {
            product_id: params.productId,
            quantity: params.quantity,
          },
        ],
        billing_address: {
          city: params.billing.city,
          country: params.billing.country,
          state: params.billing.state,
          street: params.billing.street,
          zipcode: params.billing.zipcode,
        },
        confirm: true,
        customer: { email: params.customer.email, name: params.customer.name },
        return_url: env.get('FRONTEND_URL'),
        metadata: params.metadata,
      })

      logger.info('Dodo subscription created successfully', {
        checkoutUrl: response.checkout_url,
        sessionId: response.session_id,
      })

      return {
        checkoutUrl: response.checkout_url,
        sessionId: response.session_id,
      }
    } catch (error) {
      this.handleDodoApiError(error)
    }
  }

  /**
   * Create a new Group Subscription
   * @param params - typed using interface CreateIndividualSubscriptionParams.
   * @param customerEmail - From the user passed to the customer object in the params object.
   * @param customerName - From the user passed to the customer object in the params object.
   * @returns Payment link and subscription details
   */
  async createGroupSubscription(
    params: CreateGroupSubscriptionParams
  ): Promise<SubscriptionCreateResponse> {
    try {
      const response = await this.client.checkoutSessions.create({
        product_cart: [
          {
            product_id: params.productId,
            quantity: params.quantity,
            addons: [{ addon_id: params.addons[0].addon_id, quantity: params.addons[0].quantity }],
          },
        ],
        billing_address: {
          city: params.billing.city,
          country: params.billing.country,
          state: params.billing.state,
          street: params.billing.street,
          zipcode: params.billing.zipcode,
        },
        confirm: true,
        customer: { email: params.customer.email, name: params.customer.name },
        return_url: env.get('FRONTEND_URL'),
        metadata: params.metadata,
      })

      logger.info('Dodo subscription created successfully', {
        checkoutUrl: response.checkout_url,
        sessionId: response.session_id,
      })

      return {
        checkoutUrl: response.checkout_url,
        sessionId: response.session_id,
      }
    } catch (error) {
      this.handleDodoApiError(error)
    }
  }

  /**
   * Get detailed information about a specific subscription.
   */
  async retrieveSubscription(dodoSubscriptionId: string): Promise<Partial<Subscription>> {
    try {
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
    } catch (error) {
      this.handleDodoApiError(error)
    }
  }

  /**
   * Change from current plan to one of monthly, or quarterly, or annual plans for an Individual Subscription
   * @param params - is an object with interface ChangeSubscriptionPlan has the following properties :-
   * @property newProduct,
   * @property quantity which is always 1 since you can only have one active subscription, different from addons.quantity.
   * @property prorationBillingMode can either be 'prorated_immediately' | 'full_immediately' | 'difference_immediately' as from dodo payments, and @property addons of type AttachAddon[] from dodo payments types.
   * Each object of addons takes shape of {addon_id: string, quantity:number}
   * @property quantity in addons is the seat count.
   * @return Returns a success message string on success or error for an error(done at controller level)
   */
  async changeIndividualSubscriptionPlan(
    dodoSubscriptionId: string,
    params: ChangeIndividualSubscriptionPlanParams
  ): Promise<string> {
    try {
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
    } catch (error) {
      this.handleDodoApiError(error)
    }
  }

  /**
   * Change from current plan to one of monthly, or quarterly, or annual plans for an Group Subscription
   * @param params - is an object with interface ChangeSubscriptionPlan has the following properties :-
   * @property newProduct,
   * @property quantity which is always 1 since you can only have one active subscription, different from addons.quantity.
   * @property prorationBillingMode can either be 'prorated_immediately' | 'full_immediately' | 'difference_immediately' as from dodo payments, and @property addons of type AttachAddon[] from dodo payments types.
   * Each object of addons takes shape of {addon_id: string, quantity:number}
   * @property quantity in addons is the seat count.
   * @return Returns a success message string on success or error for an error(done at controller level)
   */
  async changeGroupSubscriptionPlan(
    dodoSubscriptionId: string,
    params: ChangeGroupSubscriptionPlanParams
  ): Promise<string> {
    try {
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
    } catch (error) {
      this.handleDodoApiError(error)
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
  ): Promise<Partial<Subscription>> {
    try {
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
    } catch (error) {
      this.handleDodoApiError(error)
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
  ): Promise<Partial<Subscription>> {
    try {
      const subscription = await this.client.subscriptions.update(subscriptionId, {
        cancel_at_next_billing_date: cancelAtPeriodEnd,
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
    } catch (error) {
      this.handleDodoApiError(error)
    }
  }

  async getIndividualCustomerPortalLink(userId: number): Promise<{ link: string }> {
    try {
      const subscription = await IndividualSubscription.query()
        .where('user_id', userId)
        .whereIn('status', ['active', 'on_hold'])
        .firstOrFail()

      if (!subscription.dodoCustomerId) {
        throw new Exception('Customer ID not found. Please contact support.')
      }

      const response = await this.client.customers.customerPortal.create(
        subscription.dodoCustomerId,
        { send_email: false }
      )

      logger.info('Customer portal link generated', {
        userId,
        customerId: subscription.dodoCustomerId,
      })

      return { link: response.link }
    } catch (error) {
      this.handleDodoApiError(error)
    }
  }

  async getGroupCustomerPortalLink(userId: number): Promise<{ link: string }> {
    try {
      const subscription = await GroupSubscription.query()
        .where('owner_id', userId)
        .whereIn('status', ['active', 'on_hold'])
        .firstOrFail()

      if (!subscription.dodoCustomerId) {
        throw new Exception('Customer ID not found. Please contact support.')
      }

      const response = await this.client.customers.customerPortal.create(
        subscription.dodoCustomerId,
        { send_email: false }
      )

      logger.info('Customer portal link generated', {
        userId,
        customerId: subscription.dodoCustomerId,
      })

      return { link: response.link }
    } catch (error) {
      this.handleDodoApiError(error)
    }
  }
}
