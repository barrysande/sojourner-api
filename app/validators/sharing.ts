import vine from '@vinejs/vine'

export const shareGemsValidator = vine.compile(
  vine.object({
    gemIds: vine.array(vine.number().positive()).minLength(1).maxLength(20),
    permissionLevel: vine.enum(['view', 'edit', 'admin']).optional(),
  })
)

export const unshareGemsValidator = vine.compile(
  vine.object({
    gemIds: vine.array(vine.number().positive()).minLength(1).maxLength(20),
  })
)
