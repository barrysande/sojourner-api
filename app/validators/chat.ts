import vine from '@vinejs/vine'

export const chatGroupValidator = vine.create({
  shareGroupId: vine.number().positive(),
})

export const messageHistoryValidator = vine.create({
  page: vine.number().positive().optional(),
  limit: vine.number().positive().max(100).optional(),
})

export const deleteMessageValidator = vine.create({
  messageId: vine.number().positive(),
})
