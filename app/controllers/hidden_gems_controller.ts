import type { HttpContext } from '@adonisjs/core/http'
import Photo from '#models/photo'
import HiddenGem from '#models/hidden_gem'
import { getMetaData } from '@adonisjs/core/commands'
import { hiddenGemWithPhotosValidator } from '#validators/cloudinary_photo'
import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'
import TierService from '#services/tier_service'
import CloudinaryService from '#services/cloudinary_service'

@inject()
export default class HiddenGemsController {
  constructor(
    private tierService: TierService,
    private cloudinaryService: CloudinaryService
  ) {}

  // HELPER FUNCTION TO VALIDATE PHOTOS IN BATCHES
  private async validatePhotosBatch(photos: any[]): Promise<{
    isValid: boolean
    error?: string
    invalidIndex?: number
  }> {
    if (!photos || photos.length === 0) {
      return { isValid: true }
    }

    for (const [i, photo] of photos.entries()) {
      if (!this.cloudinaryService.validateCloudinaryResponse(photo)) {
        return {
          isValid: false,
          error: `Photo #${i + 1} has invalid data. Please remove and re-upload it.`,
          invalidIndex: i,
        }
      }
    }
    return { isValid: true }
  }

  //   LIST ALL HIDDEN GEMS
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

  //SHOW ONE HIDDEN GEM BASED ON THE ID
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
      if (error.code === 'E_ROW_NOT_FOUND') {
        return response.notFound({
          message: 'Hidden gem not found',
          code: 'GEM_NOT_FOUND',
        })
      }
      throw error
    }
  }

  // POST CREATE A HIDDEN GEM POST
  async store({ request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const data = await request.validateUsing(hiddenGemWithPhotosValidator)

      // 1. Use tierService to check if user can create more gems 2. check if the photos submitted by user are within tier limits 3. validate cloudinary photos metadata using validatePhotosBatch method 4. Create new hidden gem with any photo submitted 5. return the created gem
      const gemCheck = await this.tierService.canCreateGem(user.id)

      if (!gemCheck.canCreate) {
        return response.forbidden({
          message: gemCheck.message,
          current: gemCheck.currentCount,
          limit: gemCheck.limit,
          upgradeMessage: this.tierService.getUpgrageMessage(user.tier, 'more gems'),
        })
      }

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

        const photoValidation = await this.validatePhotosBatch(data.photos)
        if (!photoValidation.isValid) {
          return response.badRequest({
            message: photoValidation.error,
            code: 'INVALID_PHOTO_DATA',
            invalidPhotoIndex: photoValidation.invalidIndex,
          })
        }
      }

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
            cloudinaryPublicId: photo.public_id,
            cloudinaryUrl: photo.url,
            cloudinarySecureUrl: photo.secure_url,
            fileName: photo.original_filename || `photo-${index + 1}.jpg`,
            caption: photo.caption || null,
            isPrimary: index === 0, // make the first photo is primary
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

  // UPDATE A HIDDEN GEM BASED ON ID
  async update({ params, response, request, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const data = await request.validateUsing(hiddenGemWithPhotosValidator)

      // 1. get the hidden gem based on id and userId 2. use tierService to check photos to be added against limits 3. validate cloudinary photos metadata using validatePhotosBatch method 4. update the hidden gem 5. return the updated gem
      const gem = await HiddenGem.query()
        .where('id', params.id)
        .where('userId', user.id)
        .firstOrFail()

      if (data.photos && data.photos.length > 0) {
        const photoCheck = await this.tierService.canAddPhotosToGem(
          user.id,
          gem.id,
          data.photos.length
        )
        if (!photoCheck.canAdd) {
          return response.forbidden({
            message:
              photoCheck.message ||
              `Adding ${data.photos.length} photos would exceed the limit of ${photoCheck.limit}`,
            current: photoCheck.currentCount,
            limit: photoCheck.limit,
            attempted: data.photos.length,
          })
        }

        const photoValidation = await this.validatePhotosBatch(data.photos)
        if (!photoValidation.isValid) {
          return response.badRequest({
            message: photoValidation.error,
            code: 'INVALID_PHOTO_DATA',
            invalidPhotoIndex: photoValidation.invalidIndex,
          })
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

  // DELETE HIDDEN GEM AND CLEANUP PHOTOS ON CLOUDINARY
  async destroy({ params, response, auth }: HttpContext) {
    // 1. get the gem to be deleted using id and userId 2. get the gem photos' cloudinaryPublicIds 3. cleanup/delete the gem's photos on cloudinary 4. check for failed cloudinary cleanups. 4. delete hidden gem
    try {
      const user = auth.getUserOrFail()

      const gem = await HiddenGem.query()
        .where('id', params.id)
        .where('userId', user.id)
        .preload('photos')
        .firstOrFail()

      const publicIds = gem.photos.map((photo) => photo.cloudinaryPublicId)

      const bulkDeleteResult = await this.cloudinaryService.deleteMultipleImages(publicIds)

      if (bulkDeleteResult.failed.length > 0) {
        return response.badRequest({
          message: 'Failed to cleanup some photos. Gem not deleted.',
          failedPhotos: bulkDeleteResult.failed,
        })
      }

      await gem.delete()

      return response.ok({
        message: 'Hidden gem deleted successfully',
        photoCleanup: {
          successful: bulkDeleteResult.successful,
          failed: bulkDeleteResult.failed,
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

  //ADDING PHOTOS TO AN EXISTING GEM
  async addPhotos({ params, auth, request, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const photos = request.input('photos', [])

      // 1. check if request has photos 2. get the gem using gem id and userId 3. check users' tier limits 4. check if user can add photos based on tier limits 5. validate cloudinary photos metadata using validatePhotosBatch method 6. create photo records if tests pass

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

      const photoCheck = await this.tierService.canAddPhotosToGem(user.id, gem.id, photos.length)
      if (!photoCheck.canAdd) {
        return response.forbidden({
          message: photoCheck.message,
          current: photoCheck.currentCount,
          limit: photoCheck.limit,
          attempted: photos.length,
        })
      }

      const photoValidation = await this.validatePhotosBatch(photos)
      if (!photoValidation.isValid) {
        return response.badRequest({
          message: photoValidation.error,
          code: 'INVALID_PHOTO_DATA',
          invalidPhotoIndex: photoValidation.invalidIndex,
        })
      }

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
        data: newPhotos,
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

  // REASSIGN THE PRIMARY PHOTO INCASE ITS DELETED
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

  // DELETE ONE PHOTO
  async deletePhoto({ params, auth, response }: HttpContext) {
    // 1. get photo to be deleted using photo id and userId 2. create variable to hold primary photo 3. delete photo from cloudinary then database 4. check if deleted photo was primary then reassign primary status to next photo.
    try {
      const user = auth.getUserOrFail()

      const photo = await Photo.query()
        .where('id', params.photoId)
        .whereHas('hiddenGem', (query) => {
          query.where('userId', user.id).where('id', params.id)
        })
        .firstOrFail()

      const wasPrimary = photo.isPrimary

      const deleteResult = await this.cloudinaryService.deleteImage(photo.cloudinaryPublicId)

      await photo.delete()

      if (wasPrimary) {
        await this.reassignPrimaryPhoto(params.id)
      }

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

      throw error
    }
  }
}
