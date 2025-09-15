import vine from '@vinejs/vine'

export const expensesValidator = vine.compile(
  vine.object({
    description: vine.string().minLength(1).maxLength(255),
    amount: vine.number().positive(),
    currency: vine.string().fixedLength(2),
    category: vine.string().maxLength(100),
  })
)
