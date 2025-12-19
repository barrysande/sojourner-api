import vine from '@vinejs/vine'

export const paginationValidator = vine.create({
  page: vine.number().positive().optional(),
  limit: vine.number().positive().max(50).optional(),
})
