import vine from '@vinejs/vine'

export const paginationValidator = vine.create({
  page: vine.number().positive().optional(),
  perPage: vine.number().positive().max(50).optional(),
})

export const markNotificationsValidator = vine.create({
  notificationIds: vine.array(vine.number().positive()),
})
