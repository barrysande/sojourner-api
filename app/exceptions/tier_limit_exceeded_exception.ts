import { Exception } from '@adonisjs/core/exceptions'

export default class TierLimitExceededException extends Exception {
  static status = 403
  static code = 'E_TIER_LIMIT_EXCEEDED'
}
