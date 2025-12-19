import vine from '@vinejs/vine'

export const fileUploadValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(255),
  location: vine.string().trim().minLength(1).maxLength(255),
  description: vine.string().trim().optional(),
})

export const updateGemValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(255).optional(),
  location: vine.string().trim().minLength(1).maxLength(255).optional(),
  description: vine.string().trim().optional(),
})
