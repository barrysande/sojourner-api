import vine from '@vinejs/vine'

export const shareGemsValidator = vine.create({
  gemIds: vine.array(vine.number().positive()).minLength(1).maxLength(20),
  permissionLevel: vine.enum(['view', 'edit', 'admin']).optional(),
})

export const unshareGemsValidator = vine.create({
  gemIds: vine.array(vine.number().positive()).minLength(1).maxLength(20),
})
