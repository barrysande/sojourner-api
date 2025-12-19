import type { HttpContext } from '@adonisjs/core/http'
import Photo from '#models/photo'
import HiddenGem from '#models/hidden_gem'
import { fileUploadValidator, updateGemValidator } from '#validators/file_upload'
import db from '@adonisjs/lucid/services/db'
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
    try {
      const user = auth.getUserOrFail()
      const data = await request.validateUsing(fileUploadValidator)
      const photos = request.files('photos', {
        size: '10mb',
        extnames: ['jpg', 'jpeg', 'png', 'webp'],
      })

      // 1. Check if user can create more gems
      const gemCheck = await this.tierService.canCreateGem(user.id)
      if (!gemCheck.canCreate) {
        return response.forbidden({
          message: gemCheck.message,
          current: gemCheck.currentCount,
          limit: gemCheck.limit,
          upgradeMessage: this.tierService.getUpgrageMessage(user.tier, 'more gems'),
        })
      }

      // 2. Validate photo count against tier limits
      if (photos && photos.length > 0) {
        const photoCheck = await this.tierService.canAddPhotosToGem(user.id, 0, photos.length)
        if (!photoCheck.canAdd) {
          return response.forbidden({
            message: photoCheck.message,
            attempted: photos.length,
            limit: photoCheck.limit,
            upgradeMessage: this.tierService.getUpgrageMessage(user.tier, 'more photos per gem'),
          })
        }

        // 3. Validate each file
        for (const photo of photos) {
          const validation = this.imageProcessingService.validateImage(photo)
          if (!validation.isValid) {
            return response.badRequest({
              message: validation.error,
              code: 'INVALID_IMAGE',
            })
          }

          // 4. Validate file size per tier
          const sizeValidation = this.tierService.validateFileSize(photo.size!, user.tier)
          if (!sizeValidation.isValid) {
            return response.badRequest({
              message: sizeValidation.error,
              code: 'FILE_SIZE_EXCEEDED',
            })
          }
        }
      }

      await db.transaction(async (trx) => {
        // 5. Create gem
        const newGem = await HiddenGem.create(
          {
            userId: user.id,
            name: data.name,
            location: data.location,
            description: data.description,
            isPublic: false,
          },
          { client: trx }
        )

        // 6. Process and upload photos
        if (photos && photos.length > 0) {
          const photoRecords = []
          const disk = drive.use()

          for (const [index, photo] of photos.entries()) {
            // 6.1 Process image
            const processed = await this.imageProcessingService.processAndSave(
              photo,
              user.id,
              newGem.id
            )

            // 6.2 Upload to R2 using Drive
            await disk.put(processed.fullKey, processed.fullBuffer)
            await disk.put(processed.thumbKey, processed.thumbBuffer)

            // 6.3 Create photo record
            photoRecords.push({
              hiddenGemId: newGem.id,
              storageKey: processed.fullKey,
              thumbnailStorageKey: processed.thumbKey,
              originalFileName: photo.clientName,
              caption: null,
              isPrimary: index === 0,
              fileSize: processed.metadata.size,
              mimeType: processed.metadata.mimeType,
              width: processed.metadata.width,
              height: processed.metadata.height,
            })
          }

          await Photo.createMany(photoRecords, { client: trx })
        }
      })

      // FE integration notes - redirect users to hidden gems list after this.
      return response.created({
        message: 'Hidden gem created successfully',
      })
    } catch (error) {
      if (error.code === 'E_VALIDATION_ERROR') {
        return response.badRequest({
          message: 'Validation failed',
          errors: error.messages,
        })
      }
      throw error
    }
  }

  // UPDATE HIDDEN GEM
  async update({ params, response, request, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const data = await request.validateUsing(updateGemValidator)

      const photos = request.files('photos', {
        size: '10mb',
        extnames: ['jpg', 'jpeg', 'png', 'webp'],
      })

      const gem = await HiddenGem.query()
        .where('id', params.id)
        .where('userId', user.id)
        .firstOrFail()

      //1. Validate photo addition against tier limits
      if (photos && photos.length > 0) {
        const photoCheck = await this.tierService.canAddPhotosToGem(user.id, gem.id, photos.length)
        if (!photoCheck.canAdd) {
          return response.forbidden({
            message: photoCheck.message,
            current: photoCheck.currentCount,
            limit: photoCheck.limit,
            attempted: photos.length,
          })
        }

        // 2. Validate each file size within limits
        for (const photo of photos) {
          const validation = this.imageProcessingService.validateImage(photo)
          if (!validation.isValid) {
            return response.badRequest({
              message: validation.error,
              code: 'INVALID_IMAGE',
            })
          }

          const sizeValidation = this.tierService.validateFileSize(photo.size!, user.tier)
          if (!sizeValidation.isValid) {
            return response.badRequest({
              message: sizeValidation.error,
              code: 'FILE_SIZE_EXCEEDED',
            })
          }
        }
      }

      await db.transaction(async (trx) => {
        gem.useTransaction(trx)

        // 3. Update gem details
        await gem
          .merge({
            name: data.name,
            location: data.location,
            description: data.description,
            visited: data.visited ?? false,
            rating: data.rating,
          })
          .save()

        // 4. Process and upload new photos
        if (photos && photos.length > 0) {
          const photoRecords = []
          const disk = drive.use()

          for (const photo of photos) {
            const processed = await this.imageProcessingService.processAndSave(
              photo,
              user.id,
              gem.id
            )

            await disk.put(processed.fullKey, processed.fullBuffer)
            await disk.put(processed.thumbKey, processed.thumbBuffer)

            photoRecords.push({
              hiddenGemId: gem.id,
              storageKey: processed.fullKey,
              thumbnailStorageKey: processed.thumbKey,
              originalFileName: photo.clientName,
              caption: null,
              isPrimary: false,
              fileSize: processed.metadata.size,
              mimeType: processed.metadata.mimeType,
              width: processed.metadata.width,
              height: processed.metadata.height,
            })
          }

          await Photo.createMany(photoRecords, { client: trx })
        }
      })

      // FE integration notes - redirect users to hidden gems list after this.
      return response.ok({
        message: 'Hidden Gem updated successfully',
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

  // ADD PHOTOS TO EXISTING GEM
  async addPhotos({ params, auth, request, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const photos = request.files('photos', {
        size: '10mb',
        extnames: ['jpg', 'jpeg', 'png', 'webp'],
      })

      if (!photos || photos.length === 0) {
        return response.badRequest({
          message: 'No photos provided!',
          code: 'NO_PHOTOS_PROVIDED',
        })
      }

      const gem = await HiddenGem.query()
        .where('id', params.id)
        .where('userId', user.id)
        .firstOrFail()

      const photoCheck = await this.tierService.canAddPhotosToGem(user.id, gem.id, photos.length)
      if (!photoCheck.canAdd) {
        return response.forbidden({
          message: photoCheck.message,
          current: photoCheck.currentCount,
          limit: photoCheck.limit,
          attempted: photos.length,
        })
      }

      for (const photo of photos) {
        const validation = this.imageProcessingService.validateImage(photo)
        if (!validation.isValid) {
          return response.badRequest({
            message: validation.error,
            code: 'INVALID_IMAGE',
          })
        }

        const sizeValidation = this.tierService.validateFileSize(photo.size!, user.tier)
        if (!sizeValidation.isValid) {
          return response.badRequest({
            message: sizeValidation.error,
            code: 'FILE_SIZE_EXCEEDED',
          })
        }
      }

      const newPhotos = await db.transaction(async (trx) => {
        const photoRecords = []
        const disk = drive.use()

        for (const photo of photos) {
          const processed = await this.imageProcessingService.processAndSave(photo, user.id, gem.id)

          await disk.put(processed.fullKey, processed.fullBuffer)
          await disk.put(processed.thumbKey, processed.thumbBuffer)

          photoRecords.push({
            hiddenGemId: gem.id,
            storageKey: processed.fullKey,
            thumbnailStorageKey: processed.thumbKey,
            originalFileName: photo.clientName,
            caption: null,
            isPrimary: false,
            fileSize: processed.metadata.size,
            mimeType: processed.metadata.mimeType,
            width: processed.metadata.width,
            height: processed.metadata.height,
          })
        }

        return await Photo.createMany(photoRecords, { client: trx })
      })

      const photosWithUrls = await this.imageProcessingService.getPhotoUrls(newPhotos)

      return response.created({
        message: 'Photos added successfully',
        data: photosWithUrls,
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
