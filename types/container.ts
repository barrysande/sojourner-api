import type CloudinaryService from '#services/cloudinary_service'
import type TierService from '#services/tier_service'
import type PasswordResetService from '#services/password_reset_service'
import type { WebhookService } from '#services/webhook_processor_service'
// import type NotificationService from '#services/notification_service'
// import type SharingService from '#services/sharing_service'
// import type ShareGroupService from '#services/share_group_service'

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    cloudinaryService: CloudinaryService
    tierService: TierService
    passwordResetService: PasswordResetService
    webhookService: WebhookService

    // notificationService: NotificationService
    // sharingService: SharingService
    // shareGroupService: ShareGroupService
  }
}
