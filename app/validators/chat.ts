import vine from '@vinejs/vine'

export const chatGroupValidator = vine.compile(
  vine.object({
    shareGroupId: vine.number().positive(),
  })
)

export const messageHistoryValidator = vine.compile(
  vine.object({
    page: vine.number().positive().optional(),
    limit: vine.number().positive().max(100).optional(),
  })
)

export const deleteMessageValidator = vine.compile(
  vine.object({
    messageId: vine.number().positive(),
  })
)
