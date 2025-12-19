import vine from '@vinejs/vine'

export const createNoteValidator = vine.create({
  content: vine.string().trim().minLength(1),
})

export const updateNoteValidator = vine.create({
  content: vine.string().trim().minLength(1).optional(),
})
