import { Exception } from '@adonisjs/core/exceptions'
import { HttpContext } from '@adonisjs/core/http'

export class SubscriptionGatewayUnavailableError extends Exception {
  static status = 503
  static code = 'E_SUBSCRIPTION_GATEWAY_UNAVAILABLE'

  constructor(
    message: string = 'Subscription service is temporarily unavailable. Try again later.'
  ) {
    super(message, { status: 503, code: 'E_SUBSCRIPTION_GATEWAY_UNAVAILABLE' })
  }
}

export class InvalidSubscriptionDataError extends Exception {
  static status = 422
  static code = 'E_INVALID_SUBSCRIPTION_DATA'

  constructor(
    message: string = 'Invalid subscription data provided',
    public readonly errors?: Record<string, string[]>
  ) {
    super(message, { status: 422, code: 'E_INVALID_SUBSCRIPTION_DATA' })
  }
}

export class SubscriptionNotFoundError extends Exception {
  static status = 404
  static code = 'E_SUBSCRIPTION_NOT_FOUND'

  constructor() {
    super(`Subscription not found`, {
      status: 404,
      code: 'E_SUBSCRIPTION_NOT_FOUND',
    })
  }
}

export class ProductNotFoundError extends Exception {
  static status = 404
  static code = 'E_PRODUCT_NOT_FOUND'

  constructor() {
    super(`Product not found in payment gateway`, {
      status: 404,
      code: 'E_PRODUCT_NOT_FOUND',
    })
  }
}

export class AddonNotFoundError extends Exception {
  static status = 404
  static code = 'E_ADDON_NOT_FOUND'

  constructor() {
    super(`Addon not found`, {
      status: 404,
      code: 'E_ADDON_NOT_FOUND',
    })
  }
}

export class SubscriptionPaymentDeclinedError extends Exception {
  static status = 402
  static code = 'E_SUBSCRIPTION_PAYMENT_DECLINED'

  constructor(message: string = 'Subscription payment was declined') {
    super(message, { status: 402, code: 'E_SUBSCRIPTION_PAYMENT_DECLINED' })
  }
}

export class SubscriptionPaymentFailedError extends Exception {
  static status = 402
  static code = 'E_SUBSCRIPTION_PAYMENT_FAILED'

  constructor(message: string = 'Subscription payment failed') {
    super(message, { status: 402, code: 'E_SUBSCRIPTION_PAYMENT_FAILED' })
  }
}

export class InvalidSubscriptionStateError extends Exception {
  static status = 422
  static code = 'E_INVALID_SUBSCRIPTION_STATE'

  constructor(message: string) {
    super(message, { status: 422, code: 'E_INVALID_SUBSCRIPTION_STATE' })
  }
}

export class SubscriptionAlreadyCancelledError extends Exception {
  static status = 422
  static code = 'E_SUBSCRIPTION_ALREADY_CANCELLED'

  constructor() {
    super(`Subscription is already cancelled`, {
      status: 422,
      code: 'E_SUBSCRIPTION_ALREADY_CANCELLED',
    })
  }
}

export class SubscriptionExpiredError extends Exception {
  static status = 422
  static code = 'E_SUBSCRIPTION_EXPIRED'

  constructor() {
    super(`Subscription has expired`, {
      status: 422,
      code: 'E_SUBSCRIPTION_EXPIRED',
    })
  }
}

export class InvalidPlanChangeError extends Exception {
  static status = 422
  static code = 'E_INVALID_PLAN_CHANGE'

  constructor(message: string = 'Invalid subscription plan change') {
    super(message, { status: 422, code: 'E_INVALID_PLAN_CHANGE' })
  }
}

export class SubscriptionQuantityError extends Exception {
  static status = 422
  static code = 'E_SUBSCRIPTION_QUANTITY_ERROR'

  constructor(message: string = 'Invalid subscription quantity') {
    super(message, { status: 422, code: 'E_SUBSCRIPTION_QUANTITY_ERROR' })
  }
}

export class InvalidWebhookSignatureError extends Exception {
  static status = 401
  static code = 'E_INVALID_WEBHOOK_SIGNATURE'

  constructor() {
    super('Invalid webhook signature', {
      status: 401,
      code: 'E_INVALID_WEBHOOK_SIGNATURE',
    })
  }
}

export class UnknownWebhookEventError extends Exception {
  static status = 422
  static code = 'E_UNKNOWN_WEBHOOK_EVENT'

  constructor() {
    super(`Unknown webhook event type: `, {
      status: 422,
      code: 'E_UNKNOWN_WEBHOOK_EVENT',
    })
  }
}

export class SubscriptionGatewayAuthError extends Exception {
  static status = 401
  static code = 'E_SUBSCRIPTION_GATEWAY_AUTH'

  constructor(message: string = 'Payment gateway authentication failed') {
    super(message, { status: 401, code: 'E_SUBSCRIPTION_GATEWAY_AUTH' })
  }
}

export class InvalidDiscountCodeError extends Exception {
  static status = 422
  static code = 'E_INVALID_DISCOUNT_CODE'

  constructor() {
    super(`Discount code is invalid or expired`, {
      status: 422,
      code: 'E_INVALID_DISCOUNT_CODE',
    })
  }
}

export class AlreadySubscribedToPlanError extends Exception {
  static status = 400
  static code = 'E_ALREADY_SUBSCRIBED_TO_PLAN'
  constructor() {
    super(`Already subscribed to plan`, {
      status: 400,
      code: 'E_ALREADY_SUBSCRIBED_TO_PLAN',
    })
  }
}

export class UserAlreadyInGroupException extends Exception {
  static status = 409
  static code = 'E_USER_ALREADY_IN_GROUP'

  constructor() {
    super('You are already an active member of this group.')
  }
}

export class OwnerRemovalException extends Exception {
  static status = 400
  static code = 'E_OWNER_CANNOT_BE_REMOVED'

  constructor() {
    super('Owner cannot remove themselves. Dissolve the group instead.')
  }
}

export class ActionDeniedException extends Exception {
  static status = 400
  static code = 'E_ONLY_OWNER_CAN_REMOVE'

  constructor(message: string) {
    super(message)
  }
}

export class DomainException extends Exception {
  static status = 400
  static code = 'E_DOMAIN_EXCEPTION'

  constructor(message: string) {
    super(message)
  }
}

export class WebhookVerificationException extends Exception {
  static status = 400
  static code = 'WEBHOOK_VERIFICATION_FAILED'
  constructor(message: string = 'Webhook signature verification failed', options: any) {
    super(message, options)
  }

  async handle(error: this, ctx: HttpContext) {
    ctx.response.status(error.status).send({
      errors: [
        {
          message: error.message,
          code: WebhookVerificationException.code,
        },
      ],
    })
  }
}
