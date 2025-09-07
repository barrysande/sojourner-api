import type { HttpContext } from '@adonisjs/core/http'
import Photo from '#models/photo'
import HiddenGem from '#models/hidden_gem'
import { inject } from '@adonisjs/core'
import type CloudinaryService from '#services/cloudinary_service'
import type TierService from '#services/tier_service'
import { getMetaData } from '@adonisjs/core/commands'
import { hiddenGemWithPhotosValidator } from '#validators/cloudinary_photo'
import db from '@adonisjs/lucid/services/db'

@inject()
export default class HiddenGemsController {
  constructor(
    private cloudinaryService: CloudinaryService,
    private tierService: TierService
  ) {}

  //   List all hidden gems
  async index({ request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const page = request.input('page', 1)
      const limit = request.input('limit', 20)

      const gems = await HiddenGem.query()
        .where('userId', user.id)
        .preload('photos', (gemsQuery) => {
          gemsQuery.select(['id', 'cloudinaryPublicId', 'caption', 'isPrimary'])
          gemsQuery.orderBy('isPrimary', 'desc')
          gemsQuery.orderBy('createdAt', 'asc')
        })
        .orderBy('createdAt', 'desc')
        .paginate(page, limit)

      return response.ok({
        data: gems.toJSON(),
        meta: getMetaData(),
      })
    } catch (error) {
      throw error
    }
  }

  //   Show one hidden gem based on id GET /hidden_gem/:id

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
        .firstOrFail()

      return response.ok(gem)
    } catch (error) {
      if (error === 'E_ROW_NOT_FOUND') {
        return response.notFound({
          message: 'Hidden gem not found',
          code: 'GEM_NOT_FOUND',
        })
      }
      throw error
    }
  }

  //   Create a hidden gem POST

  async store({ request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const data = await request.validateUsing(hiddenGemWithPhotosValidator)

      const gemCheck = await this.tierService.canCreateGem(user.id)

      // Check if user can create more gems

      if (!gemCheck.canCreate) {
        return response.forbidden({
          message: gemCheck.message,
          current: gemCheck.currentCount,
          limit: gemCheck.limit,
          upgradeMessage: this.tierService.getUpgrageMessage(user.tier, 'unlimited gems'),
        })
      }

      // check if the photos submitted by user are within tier limits

      if (data.photos && data.photos.length > 0) {
        const photoCheck = await this.tierService.canAddPhotosToGem(user.id, 0, data.photos.length)
        if (!photoCheck.canAdd) {
          return response.forbidden({
            message: photoCheck.message,
            attempted: data.photos.length,
            limit: photoCheck.limit,
            upgradeMessage: this.tierService.getUpgrageMessage(user.tier, 'more photos per gem'),
          })
        }

        // validate each photo metadata submitted by user

        for (const photo of data.photos) {
          if (!this.cloudinaryService.validateCloudinaryResponse(photo)) {
            return response.badRequest({
              message: 'Invalid photo data',
              code: 'INVALID_PHOTO_DATA',
            })
          }
        }
      }

      // Create new hidden gem with any photo submitted

      const gem = await db.transaction(async (trx) => {
        const newGem = await HiddenGem.create(
          {
            userId: user.id,
            name: data.name,
            location: data.location,
            description: data.description,
            latitude: data.latitude,
            longitude: data.longitude,
            isPublic: false,
          },
          { client: trx }
        )

        if (data.photos && data.photos.length > 0) {
          const photoData = data.photos.map((photo, index) => ({
            hiddenGemId: newGem.id,
            publicId: photo.public_id,
            url: photo.url,
            secureUrl: photo.secure_url,
            fileName: photo.original_filename || `photo-${index + 1}.jpg`,
            caption: photo.caption || null,
            isPrimary: index === 0, // First photo is primary
          }))

          await Photo.createMany(photoData, { client: trx })
        }

        return newGem
      })

      const gemWithPhotos = await HiddenGem.query().where('id', gem.id).preload('photos').first()

      return response.created({
        message: 'Hidden gem created successfully',
        data: gemWithPhotos,
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
  async update({ params, response, request, auth }: HttpContext) {
    try {
      const user = await auth.getUserOrFail()
      const data = await request.validateUsing(hiddenGemWithPhotosValidator)

      const gem = await HiddenGem.query()
        .where('id', params.id)
        .where('userId', user.id)
        .firstOrFail()

      // check photos being added against photo limits
      if (data.photos && data.photos.length > 0) {
        const currentPhotoCount = await Photo.query()
          .where('hiddenGemId', gem.id)
          .count('* as total')

        const currentCount = currentPhotoCount[0].$extras.total
        const photoCheck = await this.tierService.canAddPhotosToGem(
          user.id,
          gem.id,
          data.photos.length
        )

        if (currentCount + data.photos.length > photoCheck.limit) {
          return response.forbidden({
            message: `Adding ${data.photos.length} photos would exceed the limit of ${photoCheck.limit}`,
            current: currentCount,
            limit: photoCheck.limit,
            attempted: data.photos.length,
          })
        }

        // validate the photo data

        for (const photo of data.photos) {
          if (!this.cloudinaryService.validateCloudinaryResponse(photo)) {
            return response.badRequest({
              message: 'Invalid phot data',
              code: 'INVALID_PHOTO_DATA',
            })
          }
        }
      }

      await db.transaction(async (trx) => {
        gem.useTransaction(trx)
        await gem
          .merge({
            name: data.name,
            location: data.location,
            description: data.description,
            latitude: data.latitude,
            longitude: data.longitude,
          })
          .save()

        // add new photos

        if (data.photos && data.photos.length > 0) {
          const photoData = data.photos.map((photo) => ({
            hiddenGemId: gem.id,
            cloudinaryPublicId: photo.public_id,
            cloudinaryUrl: photo.url,
            cloudinarySecureUrl: photo.secure_url,
            fileName: photo.original_filename || 'uploaded-photo.jpg',
            caption: photo.caption || null,
            isPrimary: false,
          }))
          await Photo.createMany(photoData, { client: trx })
        }

        return gem
      })

      const updatedGem = await HiddenGem.query().where('id', gem.id).preload('photos').first()

      return response.ok({
        message: 'Hidden Gem updated successfully',
        data: updatedGem,
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

  async destroy({ params, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const gem = await HiddenGem.query()
        .where('id', params.id)
        .where('userId', user.id)
        .preload('photos')
        .firstOrFail()

      const photoCleanupResults = []
      for (const photo of gem.photos) {
        const deleteResult = await this.cloudinaryService.deleteImage(photo.cloudinaryPublicId)
        photoCleanupResults.push({
          photoId: photo.id,
          publicId: photo.cloudinaryPublicId,
          success: deleteResult.success,
        })
      }

      // Delete gem (cascade will handle photos table)
      await gem.delete()

      return response.ok({
        message: 'Hidden gem deleted successfully',
        photoCleanup: photoCleanupResults,
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

  //adding photos to an existing gem
  async addPhotos({ params, auth, request, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const photos = request.input('photos', [])

      if (!photos || photos.length === 0) {
        return response.badRequest({
          message: 'No photos provided!',
          code: 'NO PHOTOS_PROVIDED',
        })
      }
      const gem = await HiddenGem.query()
        .where('id', params.id)
        .where('userId', user.id)
        .firstOrFail()

      // check users' tier limits

      const photoCheck = await this.tierService.canAddPhotosToGem(user.id, gem.id, photos.length)
      if (!photoCheck.canAdd) {
        response.forbidden({
          message: photoCheck.message,
          current: photoCheck.currentCount,
          limit: photoCheck.limit,
          attempted: photos.length,
        })
      }

      // validate cloudinary metadata
      for (const photo of photos) {
        if (!this.cloudinaryService.validateCloudinaryResponse(photo)) {
          return response.badRequest({
            message: 'Invalid photo data',
            code: 'INVALID_PHOTO_DATA',
          })
        }
      }

      // create photo records if tests pass

      const photoData = photos.map((photo: any) => ({
        hiddenGemId: gem.id,
        cloudinaryPublicId: photo.public_id,
        cloudinaryUrl: photo.url,
        cloudinarySecureUrl: photo.secure_url,
        fileName: photo.original_filename || 'uploaded-photo.jpg',
        caption: photo.caption || null,
        isPrimary: false,
      }))

      const newPhotos = await Photo.createMany(photoData)

      return response.created({
        message: 'Photos added successfully',
        date: newPhotos,
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

  // delete one photo

  async deletePhoto({ params, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const photo = await Photo.query()
        .where('id', params.photoId)
        .whereHas('hiddenGem', (query) => {
          query.where('userId', user.id).where('id', params.id)
        })
        .firstOrFail()

      const deleteResult = await this.cloudinaryService.deleteImage(photo.cloudinaryPublicId)

      await photo.delete()

      return response.ok({
        message: 'Photo deleted successfully',
        cloudinaryDeleted: deleteResult.success,
      })
    } catch (error) {
      if (error.code === 'E_ROW_NOT_FOUND') {
        return response.notFound({
          message: 'Photo not found',
          code: 'PHOTO_NOT_FOUND',
        })
      }
    }
  }
}
