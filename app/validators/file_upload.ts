import vine from '@vinejs/vine'

export const createGemValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(255),
  location: vine.string().trim().minLength(1).maxLength(255),
  description: vine.string().trim().optional(),
})

export const updateGemValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(255).optional(),
  location: vine.string().trim().minLength(1).maxLength(255).optional(),
  description: vine.string().trim().optional(),
  visited: vine.boolean().optional(),
  rating: vine.number().min(1).max(5).optional(),
})

export const updateAvatarValidator = vine.create({
  avatar: vine
    .nativeFile()
    .mimeTypes(['image/png', 'image/jpeg', '/image/webp', 'image/jpg'])
    .maxSize(1024 * 1024 * 10),
})
