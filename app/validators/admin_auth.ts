import vine from '@vinejs/vine'

export const registerAdminValidator = vine.create({
  email: vine.string().email(),
  password: vine.string().minLength(8),
  fullName: vine.string().minLength(2).maxLength(100),
  isAdmin: vine.boolean({ strict: true }),
})

export const loginAdminValidator = vine.create({
  email: vine.string().email().normalizeEmail().trim(),
  password: vine.string(),
})
