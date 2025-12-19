import vine from '@vinejs/vine'

export const createNoteValidator = vine.create({
  content: vine.string().trim().minLength(1),
  visited: vine.boolean().optional(),
  rating: vine.number().min(1).max(5).optional(),
})

export const updateNoteValidator = vine.create({
  content: vine.string().trim().minLength(1).optional(),
  visited: vine.boolean().optional(),
  rating: vine.number().min(1).max(5).optional(),
})
