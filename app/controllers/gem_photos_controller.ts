import type { HttpContext } from '@adonisjs/core/http'
import { addGemPhotosValidator } from '#validators/hidden_gem'
import HiddenGem from '#models/hidden_gem'
import TierService from '#services/tier_service'
import { PhotoRecord } from '../../types/hidden_gems.js'
import TierLimitExceededException from '#exceptions/tier_limit_exceeded_exception'
import ImageProcessingService from '#services/image_processing_service'
import Photo from '#models/photo'
import db from '@adonisjs/lucid/services/db'
import drive from '@adonisjs/drive/services/main'
import logger from '@adonisjs/core/services/logger'
import { inject } from '@adonisjs/core'

@inject()
export default class GemPhotosController {
  constructor(
    protected tierService: TierService,
    protected imageProcessingService: ImageProcessingService
  ) {}
  // ADD PHOTOS TO EXISTING GEM
  async store({ params, response, request, auth }: HttpContext) {
    const user = auth.getUserOrFail()

    const input = {
      ...request.all(),
      photos: request.files('photos'),
    }

    const payload = await addGemPhotosValidator.validate(input)

    const gem = await HiddenGem.query()
      .where('id', params.gemId)
      .where('userId', user.id)
      .firstOrFail()

    const photoCheck = await this.tierService.canAddPhotosToGem(
      user.id,
      gem.id,
      payload.photos.length
    )

    if (!photoCheck.canAdd) {
      return response.forbidden({
        message: photoCheck.message,
      })
    }

    for (const photo of payload.photos) {
      const sizeValidation = this.tierService.validateFileSize(photo.size, user.tier)
      if (!sizeValidation.isValid) {
        return response.badRequest({
          message: sizeValidation.error,
          code: 'FILE_SIZE_EXCEEDED',
          fileName: photo.clientName,
        })
      }
    }

    const uploadedKeys: string[] = []

    try {
      const photoRecords: PhotoRecord[] = await Promise.all(
        payload.photos.map(async (photo) => {
          const result = await this.imageProcessingService.processAndUpload(photo, user.id, gem.id)

          uploadedKeys.push(result.storageKey, result.thumbnailStorageKey)

          return {
            hiddenGemId: gem.id,
            originalFileName: photo.clientName,
            caption: null,
            isPrimary: false,
            ...result,
          }
        })
      )

      await db.transaction(async (trx) => {
        await HiddenGem.query({ client: trx }).where('id', gem.id).forUpdate().firstOrFail()

        const currentCountResult = await Photo.query({ client: trx })
          .where('hiddenGemId', gem.id)
          .count('* as total')

        const currentTotal = Number(currentCountResult[0].$extras.total)
        const limits = this.tierService.getTierLimits(user.tier)

        if (currentTotal + photoRecords.length > limits.maxPhotosPerGem) {
          throw new TierLimitExceededException(
            `Upload failed. You have reached your limit of ${limits.maxPhotosPerGem} photos per gem.`
          )
        }

        await Photo.createMany(photoRecords, { client: trx })
      })

      return response.created({
        message: 'Photos added successfully',
      })
    } catch (error) {
      if (uploadedKeys.length > 0) {
        this.imageProcessingService.deleteUploadedFiles(uploadedKeys)
      }

      if (error.code === 'E_TIER_LIMIT_EXCEEDED') {
        return response.forbidden({
          message: `Upload failed. You have reached your limit of ${this.tierService.getTierLimits(user.tier).maxPhotosPerGem} photos per gem.`,
          code: 'TIER_LIMIT_EXCEEDED',
        })
      }

      throw error
    }
  }

  // DELETE ONE PHOTO
  async destroy({ params, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const disk = drive.use()

      // 1. Fetch only the data we need (don't preload the whole world)
      const photo = await Photo.query()
        .where('id', params.photoId)
        .whereHas('hiddenGem', (query) => {
          query.where('userId', user.id).where('id', params.gemId)
        })
        .firstOrFail()

      const { isPrimary, storageKey, thumbnailStorageKey } = photo

      const r2Promise = Promise.all([
        disk.delete(storageKey),
        disk.delete(thumbnailStorageKey),
      ]).catch((err) => logger.error({ err }, 'R2 Cleanup failed'))

      await db.transaction(async (trx) => {
        photo.useTransaction(trx)
        await photo.delete()

        if (isPrimary) {
          const nextPhoto = await Photo.query({ client: trx })
            .select('id')
            .where('hiddenGemId', params.id)
            .orderBy('id', 'asc')
            .first()

          if (nextPhoto) {
            await Photo.query({ client: trx })
              .where('id', nextPhoto.id)
              .update({ is_primary: true })
          }
        }
      })

      await r2Promise

      return response.ok({ message: 'Photo deleted successfully' })
    } catch (error) {
      if (error.code === 'E_ROW_NOT_FOUND') {
        return response.notFound({ message: 'Photo not found' })
      }

      throw error
    }
  }
}
