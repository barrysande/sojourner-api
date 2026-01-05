import type { HttpContext } from '@adonisjs/core/http'
import Photo from '#models/photo'
import HiddenGem from '#models/hidden_gem'
import {
  createGemValidator,
  updateGemValidator,
  addGemPhotosValidator,
} from '#validators/hidden_gem'
import { inject } from '@adonisjs/core'
import TierService from '#services/tier_service'
import ImageProcessingService from '#services/image_processing_service'
import drive from '@adonisjs/drive/services/main'
import logger from '@adonisjs/core/services/logger'

interface FailedDeletionResults {
  key: string
  error: string
}

@inject()
export default class HiddenGemsController {
  constructor(
    private tierService: TierService,
    private imageProcessingService: ImageProcessingService
  ) {}

  // REASSIGN PRIMARY PHOTO
  private async reassignPrimaryPhoto(gemId: number): Promise<void> {
    const firstPhoto = await Photo.query()
      .where('hiddenGemId', gemId)
      .orderBy('createdAt', 'asc')
      .first()

    if (firstPhoto) {
      firstPhoto.isPrimary = true
      await firstPhoto.save()
    }
  }

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
      const photoRecords = []

      for (const [index, photo] of payload.photos.entries()) {
        const result = await this.imageProcessingService.processAndUpload(photo, user.id, gem.id)

        uploadedKeys.push(result.storageKey, result.thumbnailStorageKey)

        photoRecords.push({
          hiddenGemId: gem.id,
          originalFileName: photo.clientName,
          caption: null,
          isPrimary: index === 0,
          ...result,
        })
      }

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
      const photoRecords = []

      for (const photo of payload.photos) {
        const result = await this.imageProcessingService.processAndUpload(photo, user.id, gem.id)

        uploadedKeys.push(result.storageKey, result.thumbnailStorageKey)

        photoRecords.push({
          hiddenGemId: gem.id,
          originalFileName: photo.clientName,
          caption: null,
          isPrimary: false,
          ...result,
        })
      }

      await Photo.createMany(photoRecords)

      return response.created({
        message: 'Photos added successfully',
      })
    } catch (error) {
      if (uploadedKeys.length > 0) {
        this.imageProcessingService.deleteUploadedFiles(uploadedKeys)
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

      // Delete all photos from R2
      const deletionResults = {
        successful: [] as string[],
        failed: [] as FailedDeletionResults[],
      }

      for (const photo of gem.photos) {
        try {
          await disk.delete(photo.storageKey)

          await disk.delete(photo.thumbnailStorageKey)

          deletionResults.successful.push(photo.storageKey)
        } catch (error) {
          deletionResults.failed.push({
            key: photo.storageKey,
            error: error.message,
          })
        }
      }

      // Delete gem (cascade will delete photos from DB)
      await gem.delete()

      return response.ok({
        message: 'Hidden gem deleted successfully',
        photoCleanup: deletionResults,
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

      const photo = await Photo.query()
        .where('id', params.photoId)
        .whereHas('hiddenGem', (query) => {
          query.where('userId', user.id).where('id', params.id)
        })
        .firstOrFail()

      const wasPrimary = photo.isPrimary

      // Delete from R2
      try {
        await disk.delete(photo.storageKey)

        await disk.delete(photo.thumbnailStorageKey)
      } catch (error) {
        logger.error('R2 deletion failed', { storageKey: photo.storageKey, error: error.message })
      }

      // Delete from database
      await photo.delete()

      // Reassign primary if needed
      if (wasPrimary) {
        await this.reassignPrimaryPhoto(params.id)
      }

      return response.ok({
        message: 'Photo deleted successfully',
      })
    } catch (error) {
      if (error.code === 'E_ROW_NOT_FOUND') {
        return response.notFound({
          message: 'Photo not found',
          code: 'PHOTO_NOT_FOUND',
        })
      }
      throw error
    }
  }
}
