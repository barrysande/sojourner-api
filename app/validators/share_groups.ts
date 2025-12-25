import vine from '@vinejs/vine'

export const createShareGroupValidator = vine.create({
  name: vine.string().trim().minLength(2).maxLength(50),
  inviteEmails: vine.array(vine.string().email()).maxLength(19).optional(),
})

export const joinShareGroupValidator = vine.create({
  inviteCode: vine
    .string()
    .trim()
    .fixedLength(8)
    .regex(/^[A-Z0-9]+$/),
})

export const inviteMembersValidator = vine.create({
  emails: vine.array(vine.string().email()).maxLength(19),
})

export const acceptShareGroupInviteValidator = vine.create({
  shareGroupId: vine.number().positive(),
  userId: vine.number().positive(),
})
