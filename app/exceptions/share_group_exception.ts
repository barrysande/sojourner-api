import { Exception } from '@adonisjs/core/exceptions'

export class InvalidInviteCodeException extends Exception {
  static status = 400
  static code = 'E_INVALID_INVITE_CODE'
  static message = 'Invalid invite code'
}

export class AlreadyMemberException extends Exception {
  static status = 409
  static code = 'E_ALREADY_MEMBER'
  static message = 'You are already a member of this group'
}

export class GroupJoinDeniedException extends Exception {
  static status = 403
  static code = 'E_GROUP_JOIN_DENIED'

  constructor(message?: string) {
    super(message || 'You cannot join this group')
  }
}

export class InvalidInvitationException extends Exception {
  static status = 400
  static code = 'E_INVALID_INVITATION'
  static message = 'This invitation is no longer valid or the group was dissolved'
}

export class GroupDissolvedException extends Exception {
  static status = 400
  static code = 'E_GROUP_DISSOLVED'
  static message = 'Cannot rejoin a dissolved group'
}
