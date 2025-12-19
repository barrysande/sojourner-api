import type { HttpContext } from '@adonisjs/core/http'
import PostVisitNote from '#models/post_visit_note'
import HiddenGem from '#models/hidden_gem'
import { createNoteValidator, updateNoteValidator } from '#validators/post_visit_note'

export default class PostVisitNotesController {
  async index({ params, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const gem = await HiddenGem.query()
        .where('id', params.gemId)
        .where('userId', user.id)
        .firstOrFail()

      const notes = await PostVisitNote.query()
        .where('hiddenGemId', gem.id)
        .orderBy('createdAt', 'desc')

      return response.ok({
        data: notes,
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
      throw error
    }
  }

  async show({ params, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const note = await PostVisitNote.query()
        .where('id', params.noteId)
        .whereHas('hiddenGem', (query) => {
          query.where('userId', user.id).where('id', params.gemId)
        })
        .firstOrFail()

      return response.ok({ note })
    } catch (error) {
      if (error.code === 'E_ROW_NOT_FOUND') {
        return response.notFound({
          message: 'Note not found',
          code: 'NOTE_NOT_FOUND',
        })
      }
      throw error
    }
  }

  async store({ params, request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const data = await request.validateUsing(createNoteValidator)

      const gem = await HiddenGem.query()
        .where('id', params.gemId)
        .where('userId', user.id)
        .firstOrFail()

      await PostVisitNote.create({
        hiddenGemId: gem.id,
        content: data.content,
        visited: data.visited ?? false,
        rating: data.rating,
      })

      return response.created({
        message: 'Note created successfully',
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

  async update({ params, request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const data = await request.validateUsing(updateNoteValidator)

      const note = await PostVisitNote.query()
        .where('id', params.noteId)
        .whereHas('hiddenGem', (query) => {
          query.where('userId', user.id).where('id', params.gemId)
        })
        .firstOrFail()

      await note
        .merge({
          content: data.content,
          visited: data.visited,
          rating: data.rating,
        })
        .save()

      return response.ok({
        message: 'Note updated successfully',
        note,
      })
    } catch (error) {
      if (error.code === 'E_ROW_NOT_FOUND') {
        return response.notFound({
          message: 'Note not found',
          code: 'NOTE_NOT_FOUND',
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

  async destroy({ params, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const note = await PostVisitNote.query()
        .where('id', params.noteId)
        .whereHas('hiddenGem', (query) => {
          query.where('userId', user.id).where('id', params.gemId)
        })
        .firstOrFail()

      await note.delete()

      return response.ok({
        message: 'Note deleted successfully',
      })
    } catch (error) {
      if (error.code === 'E_ROW_NOT_FOUND') {
        return response.notFound({
          message: 'Note not found',
          code: 'NOTE_NOT_FOUND',
        })
      }
      throw error
    }
  }
}
