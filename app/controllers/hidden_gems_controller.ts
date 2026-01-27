import type { HttpContext } from '@adonisjs/core/http'
import Photo from '#models/photo'
import HiddenGem from '#models/hidden_gem'
import { createGemValidator, updateGemValidator } from '#validators/hidden_gem'
import { inject } from '@adonisjs/core'
import TierService from '#services/tier_service'
import ImageProcessingService from '#services/image_processing_service'
import drive from '@adonisjs/drive/services/main'
import { PhotoRecord } from '../../types/hidden_gems.js'
import { HiddenGemService } from '#services/hidden_gem_service'

@inject()
export default class HiddenGemsController {
  constructor(
    protected tierService: TierService,
    protected imageProcessingService: ImageProcessingService,
    protected hiddenGemService: HiddenGemService
  ) {}

  // LIST ALL HIDDEN GEMS
  async index({ request, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const page = request.input('page', 1)
    const limit = request.input('limit', 20)

    const result = await this.hiddenGemService.getUserHiddenGems(user, page, limit)

    return response.ok(result)
  }

  // SHOW ONE HIDDEN GEM
  async show({ response, auth, params }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const { gem, photos } = await this.hiddenGemService.getGemById(user, params.id)

      return response.ok({
        gem,
        photos,
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
        payload.photos.map(async (photo, index) => {
          const result = await this.imageProcessingService.processAndUpload(photo, user.id, gem.id)

          uploadedKeys.push(result.storageKey, result.thumbnailStorageKey)

          return {
            hiddenGemId: gem.id,
            originalFileName: photo.clientName,
            caption: null,
            isPrimary: index === 0,
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
}
