import { Exception } from '@adonisjs/core/exceptions'

export default class ConflictException extends Exception {
  static status = 409
  static code = 'E_CONFLICT'
}
