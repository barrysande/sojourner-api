import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import HiddenGem from '#models/hidden_gem'
import { inject } from '@adonisjs/core'
import type CloudinaryService from '#services/cloudinary_service'
import type TierService from '#services/tier_service'
import { getMetaData } from '@adonisjs/core/commands'
import { hiddenGemWithPhotosValidator } from '#validators/cloudinary_photo'

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

  async store({request, response, auth}: HttpContext){
    try{
        const user = auth.getUserOrFail()
        const data = await request.validateUsing(hiddenGemWithPhotosValidator)

        const gemCheck = await this.tierService.canCreateGem(user.id)

        if(!gemCheck.canCreate){
            return response.forbidden({
                message: gemCheck.message,
                current: gemCheck.currentCount,
                limit: gemCheck.limit,
                upgradeMessage: this.tierService.getUpgrageMessage(user.tier, 'unlimited gems')
            })
        }

        if(data.photos && data.photos.length > 0){
            const photoCheck = await this.tierService.canAddPhotosToGem(user.id, 0, data.photos.length)
        }
    }
  }
}
