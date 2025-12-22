import vine from '@vinejs/vine'

export const shareGemsValidator = vine.create({
  gemIds: vine.array(vine.number().positive()).minLength(1).maxLength(500),
  permissionLevel: vine.enum(['view', 'edit', 'admin']).optional(),
})

export const unshareGemsValidator = vine.create({
  gemIds: vine.array(vine.number().positive()).minLength(1).maxLength(500),
})

export const sharedStatusValidator = vine.create({
  gemIds: vine.array(vine.number().positive()),
})
