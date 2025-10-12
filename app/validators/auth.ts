import vine from '@vinejs/vine'

export const registerValidator = vine.compile(
  vine.object({
    email: vine.string().email(),
    password: vine.string().minLength(8),
    fullName: vine.string().minLength(2).maxLength(100),
  })
)

export const loginValidator = vine.compile(
  vine.object({
    email: vine.string().email().normalizeEmail().trim(),
    password: vine.string(),
    rememberMe: vine.boolean().optional(),
  })
)

export const changePasswordValidator = vine.compile(
  vine.object({
    currentPassword: vine.string(),
    newPassword: vine.string().minLength(8),
  })
)

export const forgotPasswordValidator = vine.compile(
  vine.object({
    email: vine.string().email(),
  })
)

export const resetPasswordValidator = vine.compile(
  vine.object({
    email: vine.string().email(),
    token: vine.string().minLength(32),
    password: vine.string().minLength(8),
  })
)

export const verifyResetTokenValidator = vine.compile(
  vine.object({
    email: vine.string().email(),
    token: vine.string().minLength(32),
  })
)
