import type { HttpContext } from '@adonisjs/core/http'
import Photo from '#models/photo'
import HiddenGem from '#models/hidden_gem'
import {
  createGemValidator,
  updateGemValidator,
  addGemPhotosValidator,
} from '#validators/hidden_gem'
import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'
import TierService from '#services/tier_service'
import ImageProcessingService from '#services/image_processing_service'
import drive from '@adonisjs/drive/services/main'
import logger from '@adonisjs/core/services/logger'
import TierLimitExceededException from '#exceptions/tier_limit_exceeded_exception'

interface PhotoRecord {
  hiddenGemId: number
  storageKey: string
  thumbnailStorageKey: string
  originalFileName: string
  caption: string | null
  isPrimary: boolean
  fileSize: number
  mimeType: string
  width: number
  height: number
}

@inject()
export default class HiddenGemsController {
  constructor(
    private tierService: TierService,
    private imageProcessingService: ImageProcessingService
  ) {}

  // LIST ALL HIDDEN GEMS
  async index({ request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const page = request.input('page', 1)
      const limit = request.input('limit', 20)

      const gems = await HiddenGem.query()
        .where('userId', user.id)
        .preload('photos', (gemsQuery) => {
          gemsQuery.select(['id', 'storageKey', 'thumbnailStorageKey', 'caption', 'isPrimary'])
          gemsQuery.orderBy('isPrimary', 'desc')
          gemsQuery.orderBy('createdAt', 'asc')
        })
        .orderBy('createdAt', 'desc')
        .paginate(page, limit)

      const serialized = gems.serialize()
      const gemsWithUrls = await Promise.all(
        serialized.data.map(async (gem) => ({
          ...gem,
          photos: await this.imageProcessingService.getPhotoUrls(
            gems.all().find((g) => g.id === gem.id)?.photos || []
          ),
        }))
      )

      return response.ok({
        data: gemsWithUrls,
        meta: serialized.meta,
      })
    } catch (error) {
      throw error
    }
  }

  // SHOW ONE HIDDEN GEM
  async show({ response, auth, params }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const gem = await HiddenGem.query()
        .where('id', params.id)
        .where('userId', user.id)
        .preload('photos', (gemQuery) => {
          gemQuery.orderBy('isPrimary', 'desc')
          gemQuery.orderBy('createdAt', 'asc')
        })
        .preload('expenses')
        .preload('postVisitNotes')
        .firstOrFail()

      const photosWithUrls = await this.imageProcessingService.getPhotoUrls(gem.photos)

      return response.ok({
        gem,
        photos: photosWithUrls,
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

  // CREATE HIDDEN GEM WITH PHOTOS
  async store({ request, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()

    const input = {
      ...request.all(),
      photos: request.files('photos'),
    }

    const payload = await createGemValidator.validate(input)

    const gemCheck = await this.tierService.canCreateGem(user.id)
    if (!gemCheck.canCreate) {
      return response.forbidden({
        message: gemCheck.message,
        upgradeMessage: this.tierService.getUpgrageMessage(user.tier, 'more gems'),
      })
    }

    const photoCheck = await this.tierService.canAddPhotosToGem(user.id, 0, payload.photos.length)
    if (!photoCheck.canAdd) {
      return response.forbidden({
        message: photoCheck.message,
        upgradeMessage: this.tierService.getUpgrageMessage(user.tier, 'more photos per gem'),
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

    const gem = await HiddenGem.create({
      userId: user.id,
      name: payload.name,
      location: payload.location,
      description: payload.description,
      isPublic: false,
    })

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

      await Photo.createMany(photoRecords)

      return response.created({
        message: 'Hidden gem created successfully',
      })
    } catch (error) {
      await gem.delete()

      if (uploadedKeys.length > 0) {
        this.imageProcessingService.deleteUploadedFiles(uploadedKeys)
      }

      throw error
    }
  }

  // UPDATE HIDDEN GEM DETAILS
  async update({ params, response, request, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const payload = await request.validateUsing(updateGemValidator)

    const gem = await HiddenGem.query()
      .where('id', params.id)
      .where('userId', user.id)
      .firstOrFail()

    await gem.merge(payload).save()

    return response.ok({ message: 'Hidden Gem updated successfully' })
  }

  // ADD PHOTOS TO EXISTING GEM
  async addPhotos({ params, response, request, auth }: HttpContext) {
    const user = auth.getUserOrFail()

    const input = {
      ...request.all(),
      photos: request.files('photos'),
    }

    const payload = await addGemPhotosValidator.validate(input)

    const gem = await HiddenGem.query()
      .where('id', params.id)
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

  // DELETE HIDDEN GEM
  async destroy({ params, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const disk = drive.use()

      const gem = await HiddenGem.query()
        .where('id', params.id)
        .where('userId', user.id)
        .preload('photos')
        .firstOrFail()

      await Promise.allSettled(
        gem.photos.flatMap((photo) => [
          disk.delete(photo.storageKey),
          disk.delete(photo.thumbnailStorageKey),
        ])
      )

      await gem.delete()

      return response.ok({
        message: 'Hidden gem deleted successfully',
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

  // DELETE ONE PHOTO
  async deletePhoto({ params, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const disk = drive.use()

      // 1. Fetch only the data we need (don't preload the whole world)
      const photo = await Photo.query()
        .where('id', params.photoId)
        .whereHas('hiddenGem', (query) => {
          query.where('userId', user.id).where('id', params.id)
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
