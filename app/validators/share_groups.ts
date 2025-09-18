import vine from '@vinejs/vine'

export const createShareGroupValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(2).maxLength(50),
    inviteEmails: vine.array(vine.string().email().minLength(1).maxLength(9)),
  })
)

export const joinShareGroupValidator = vine.compile(
  vine.object({
    inviteCode: vine
      .string()
      .trim()
      .fixedLength(8)
      .regex(/^[A-Z0-9]+$/),
  })
)

export const inviteMembersValidator = vine.compile(
  vine.object({
    emails: vine.array(vine.string().email()).minLength(1).maxLength(5),
  })
)
