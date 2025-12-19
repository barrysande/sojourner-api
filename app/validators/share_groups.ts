import vine from '@vinejs/vine'

export const createShareGroupValidator = vine.create({
  name: vine.string().trim().minLength(2).maxLength(50),
  inviteEmails: vine.array(vine.string().email().minLength(1).maxLength(9)),
})

export const joinShareGroupValidator = vine.create({
  inviteCode: vine
    .string()
    .trim()
    .fixedLength(8)
    .regex(/^[A-Z0-9]+$/),
})

export const inviteMembersValidator = vine.create({
  emails: vine.array(vine.string().email()).minLength(1).maxLength(5),
})
