import type TierService from '#services/tier_service'
import type PasswordResetService from '#services/password_reset_service'
import type WebhookService from '#services/webhook_processor_service'
import type EmailVerificationService from '#services/email_verification_service'
import type SubscriptionEmailService from '#services/subscription_email_service'

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    tierService: TierService
    passwordResetService: PasswordResetService
    webhookService: WebhookService
    emailVerificationService: EmailVerificationService
    subscriptionEmailService: SubscriptionEmailService

    // notificationService: NotificationService
    // sharingService: SharingService
    // shareGroupService: ShareGroupService
  }
}
