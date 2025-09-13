import type { ApplicationService } from '@adonisjs/core/types'

export default class AppProvider {
  constructor(protected app: ApplicationService) {}

  /**
   * Register bindings to the container
   */
  register() {
    this.registerCloudinaryService()
    this.registerTierService()
    this.registerPasswordResetService()
  }

  protected registerCloudinaryService() {
    this.app.container.singleton('cloudinaryService', async () => {
      const { default: CloudinaryService } = await import('#services/cloudinary_service')

      return new CloudinaryService()
    })
  }

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
