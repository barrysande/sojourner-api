import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import WebhookEvent from '#models/webhook_event'
import { DodoPaymentService } from '#services/dodo_payment_service'
import { WebhookVerificationException } from '#exceptions/payment_errors_exception'
import logger from '@adonisjs/core/services/logger'
import type { SubscriptionWebhookPayload } from '../../types/webhookpayload.js'

@inject()
export default class WebhooksController {
  constructor(protected dodoPaymentService: DodoPaymentService) {}
  async handle({ request, response }: HttpContext) {
    console.log(request.body())
    try {
      const rawBody = request.raw() as string
      const webhookHeaders = {
        'webhook-id': request.header('webhook-id') || '',
        'webhook-signature': request.header('webhook-signature') || '',
        'webhook-timestamp': request.header('webhook-timestamp') || '',
      }

      console.log(webhookHeaders)
      let verifiedEvent
      try {
        verifiedEvent = this.dodoPaymentService.client.webhooks.unwrap(rawBody, {
          headers: webhookHeaders,
        })
      } catch (error) {
        logger.warn('Webhook signature verification failed', {
          error: error.message,
          headers: webhookHeaders,
        })
        throw new WebhookVerificationException('Invalid webhook signature', {
          status: error.status,
          cause: error,
        })
      }

      const eventId = request.header('webhook-id')

      await WebhookEvent.create({
        eventId,
        eventType: verifiedEvent.type,
        businessId: verifiedEvent.business_id,
        status: 'pending',
        payload: verifiedEvent.data as SubscriptionWebhookPayload,
      })

      response.ok({ received: true })
    } catch (error) {
      if (error instanceof WebhookVerificationException) {
        throw error
      }

      logger.error('Error processing webhook', {
        error: error.message,
        stack: error.stack,
      })
      return response.ok({ received: true, error: 'internal_error' })
    }
  }
}
