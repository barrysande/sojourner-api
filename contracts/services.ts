import type CloudinaryService from '#services/cloudinary_service'
import type TierService from '#services/tier_service'

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    cloudinary: CloudinaryService
    tier: TierService
  }
}
