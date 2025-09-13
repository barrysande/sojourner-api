import type CloudinaryService from '#services/cloudinary_service'
import type TierService from '#services/tier_service'
import type PasswordResetService from '#services/password_reset_service'

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    cloudinaryService: CloudinaryService
    tierService: TierService
    passwordResetService: PasswordResetService
  }
}
