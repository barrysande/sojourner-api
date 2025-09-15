import type { HttpContext } from '@adonisjs/core/http'
import HiddenGem from '#models/hidden_gem'
import Expense from '#models/expense'
import { expensesValidator } from '#validators/expenses'

export default class ExpensesController {
  // GET ALL EXPENSES FOR A SPECIFIC HIDDEN GEM
  async index({ response, auth, params }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const gem = await HiddenGem.query()
        .where('id', params.gemId)
        .where('user_id', user.id)
        .firstOrFail()

      const expenses = await Expense.query()
        .where('hidden_gem_id', gem.id)
        .orderBy('created_at', 'desc')

      return response.ok({
        data: expenses,
        meta: {
          gemId: gem.id,
          gemName: gem.name,
        },
      })
    } catch (error) {
      if (error.code === 'E_ROW_NOT_FOUND') {
        return response.notFound({
          message: 'Hidden gem not found',
          code: 'GEM_NOT_FOUND',
        })
      }
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
          errors: error.messages,
        })
      }
      throw error
    }
  }
  // GET SINGLE EXPENSE
  async show({ response, auth, params }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const expense = Expense.query()
        .where('id', params.expenseId)
        .whereHas('hiddenGem', (expenseQuery) => {
          expenseQuery.where('user_id', user.id).where('id', params.gemId)
        })

      return response.ok({
        data: expense,
      })
    } catch (error) {
      if (error.code === 'E_ROW_NOT_FOUND') {
        return response.notFound({
          message: 'Expense not found',
          code: 'EXPENSE_NOT_FOUND',
        })
      }
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
          errors: error.messages,
        })
      }
      throw error
    }
  }
  async store({ request, response, params, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const data = await request.validateUsing(expensesValidator)

      const gem = await HiddenGem.query()
        .where('id', params.gemId)
        .where('user_id', user.id)
        .firstOrFail()

      const expense = await Expense.create({
        hiddenGemId: gem.id,
        description: data.description,
        amount: data.amount,
        currency: data.currency || 'KES',
        category: data.category,
      })

      return response.ok({
        message: 'Expense added successfully',
        data: expense,
      })
    } catch (error) {
      if (error.code === 'E_ROW_NOT_FOUND') {
        return response.notFound({
          message: 'Hidden gem not found',
          code: 'GEM_NOT_FOUND',
        })
      }
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
          errors: error.messages,
        })
      }
      throw error
    }
  }

  async update({ request, response, auth, params }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const data = await request.validateUsing(expensesValidator)

      const expense = await Expense.query()
        .where('id', params.expenseId)
        .whereHas('hiddenGem', (updateExpenseQuery) => {
          updateExpenseQuery.where('user_id', user.id).where('id', params.gemId)
        })
        .firstOrFail()

      expense
        .merge({
          description: data.description,
          amount: data.amount,
          currency: data.currency,
          category: data.category,
        })
        .save()
      return response.ok({
        message: 'Expense updated successfully',
        data: expense,
      })
    } catch (error) {
      if (error.code === 'E_ROW_NOT_FOUND') {
        return response.notFound({
          message: 'Expense not found',
          code: 'EXPENSE_NOT_FOUND',
        })
      }
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
          errors: error.messages,
        })
      }
      throw error
    }
  }

  async delete({ response, auth, params }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const expense = await Expense.query()
        .where('id', params.expenseId)
        .whereHas('hiddenGem', (deleteExpenseQuery) => {
          deleteExpenseQuery.where('user_id', user.id).where('hidden_gem_id', params.gemId)
        })
        .firstOrFail()

      await expense.delete()
      return response.ok({ message: 'Expense deleted successfully' })
    } catch (error) {
      if (error.code === 'E_ROW_NOT_FOUND') {
        return response.notFound({
          message: 'Expense not found',
          code: 'EXPENSE_NOT_FOUND',
        })
      }
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
          errors: error.messages,
        })
      }
      throw error
    }
  }
}
