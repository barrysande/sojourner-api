import { Exception } from '@adonisjs/core/exceptions'

export default class SubscriptionConflictException extends Exception {
  static status = 409
  static code = 'E_SUBSCRIPTION_CONFLICT'

  constructor(message: string) {
    super(message, {
      status: SubscriptionConflictException.status,
      code: SubscriptionConflictException.code,
    })
  }
}
