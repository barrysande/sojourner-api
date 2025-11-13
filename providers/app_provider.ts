import type { ApplicationService } from '@adonisjs/core/types'

export default class AppProvider {
  constructor(protected app: ApplicationService) {}

  protected registerTierService() {
    this.app.container.singleton('tierService', async () => {
      const { default: TierService } = await import('#services/tier_service')

      return new TierService()
    })
  }

  protected registerPasswordResetService() {
    this.app.container.singleton('passwordResetService', async () => {
      const { default: PasswordResetService } = await import('#services/password_reset_service')

      return new PasswordResetService()
    })
  }

  protected registerEmailVerificationService() {
    this.app.container.singleton('emailVerificationService', async () => {
      const { default: EmailVerificationService } = await import(
        '#services/email_verification_service'
      )

      return new EmailVerificationService()
    })
  }

  // protected registerNotificationService() {
  //   this.app.container.singleton('notificationService', async () => {
  //     const { default: NotificationService } = await import('#services/notification_service')

  //     return new NotificationService()
  //   })
  // }

  // protected registerSharingService() {
  //   this.app.container.singleton('sharingService', async () => {
  //     const { default: SharingService } = await import('#services/sharing_service')

  //     return new SharingService()
  //   })
  // }

  // protected registerShareGroupService() {
  //   this.app.container.singleton('shareGroupService', async () => {
  //     const { default: ShareGroupService } = await import('#services/share_group_service')

  //     return new ShareGroupService()
  //   })
  // }

  /**
   * Register bindings to the container
   */
  register() {
    this.registerTierService()
    this.registerPasswordResetService()
    this.registerEmailVerificationService()
    // this.registerNotificationService()
    // this.registerSharingService()
    // this.registerShareGroupService()
  }

  /**
   * The container bindings have booted
   */
  async boot() {}

  /**
   * The application has been booted
   */
  async start() {}

  /**
   * The process has been started
   */
  async ready() {}

  /**
   * Preparing to shutdown the app
   */
  async shutdown() {}
}
