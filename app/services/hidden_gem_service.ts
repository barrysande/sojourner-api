import { inject } from '@adonisjs/core'
import ImageProcessingService from '#services/image_processing_service'
import HiddenGem from '#models/hidden_gem'
import User from '#models/user'

@inject()
export class HiddenGemService {
  constructor(protected imageProcessingService: ImageProcessingService) {}

  async getUserHiddenGems(user: User, page: number = 1, limit: number = 20) {
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

    return {
      data: gemsWithUrls,
      meta: serialized.meta,
    }
  }

  async getGemById(user: User, gemId: string | number) {
    const gem = await HiddenGem.query()
      .where('id', gemId)
      .where('userId', user.id)
      .preload('photos', (gemQuery) => {
        gemQuery.orderBy('isPrimary', 'desc')
        gemQuery.orderBy('createdAt', 'asc')
      })
      .preload('expenses')
      .preload('postVisitNotes')
      .firstOrFail()

    const photosWithUrls = await this.imageProcessingService.getPhotoUrls(gem.photos)

    return { gem, photos: photosWithUrls }
  }
}
