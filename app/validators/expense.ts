import vine from '@vinejs/vine'

export const expensesValidator = vine.create({
  description: vine.string().minLength(1).maxLength(255),
  amount: vine.number().positive(),
  currency: vine.string().fixedLength(3),
  name: vine.string().maxLength(100),
})
