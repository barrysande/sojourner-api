import sharp from 'sharp'
import drive from '@adonisjs/drive/services/main'
import { cuid } from '@adonisjs/core/helpers'
import { MultipartFile } from '@adonisjs/core/bodyparser'
import logger from '@adonisjs/core/services/logger'
import User from '#models/user'

export default class AvatarService {
  private readonly ALLOWED_SUBTYPES = ['jpeg', 'jpg', 'png', 'webp']
  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024
  private readonly AVATAR_SIZE = 400

  /**
   * Ensure file is valid before processing
   */
  private validateImage(file: MultipartFile): void {
    if (!file) {
      throw new Error('No file provided')
    }

    const subtype = (file.subtype || '').toLowerCase()

    if (!this.ALLOWED_SUBTYPES.includes(subtype)) {
      throw new Error(`Invalid file type (${subtype}). Only JPEG, PNG, and WebP are allowed.`)
    }

    if (file.size && file.size > this.MAX_FILE_SIZE) {
      throw new Error(`File size exceeds maximum of ${this.MAX_FILE_SIZE / 1024 / 1024}MB`)
    }
  }

  /**
   * Resize to square, center crop, convert to WebP
   */
  private async processImage(file: MultipartFile): Promise<Buffer> {
    try {
      return await sharp(file.tmpPath!)
        .resize(this.AVATAR_SIZE, this.AVATAR_SIZE, {
          fit: 'cover',
          position: 'center',
        })
        .webp({ quality: 80 })
        .toBuffer()
    } catch (error) {
      logger.error({ err: error }, 'Avatar processing failed')
      throw new Error('Failed to process image')
    }
  }

  /**
   * Extract key from URL and delete from Drive
   */
  private async deleteOldAvatar(fullUrl: string): Promise<void> {
    try {
      // Logic: Extract the path relative to the bucket
      // If URL is https://cdn.site.com/avatars/123.webp -> key is avatars/123.webp
      const urlObj = new URL(fullUrl)
      // Remove the leading slash from pathname
      const key = urlObj.pathname.substring(1)

      // Safety check: ensure we are actually deleting an avatar and not something else
      if (key.startsWith('avatars/')) {
        await drive.use().delete(key)
      }
    } catch (error) {
      // Just log it, don't throw. The user has their new photo;
      // failing to delete the old one is a maintenance issue, not a user error.
      logger.warn({ url: fullUrl, err: error }, 'Could not extract key or delete old avatar')
    }
  }

  async deleteAvatar(avatarUrl: string | null): Promise<void> {
    if (!avatarUrl) return

    try {
      const urlObj = new URL(avatarUrl)
      // Remove leading slash to get the key (e.g., 'avatars/xyz.webp')
      const key = urlObj.pathname.substring(1)

      // Safety check: prevent deleting things outside the avatars folder
      if (key.startsWith('avatars/')) {
        await drive.use().delete(key)
        logger.info({ key }, 'Avatar deleted from R2')
      }
    } catch (error) {
      // Log but don't throw. If the file is already gone, we still want
      // the account deletion to succeed.
      logger.warn({ avatarUrl, err: error }, 'Failed to delete avatar file')
    }
  }

  /**
   * Main entry point: Validates, Processes, Uploads, and cleans up old avatar
   */
  async updateAvatar(user: User, file: MultipartFile): Promise<string> {
    // 1. Validation
    this.validateImage(file)

    // 2. Process Image (Resize & Convert)
    const processedBuffer = await this.processImage(file)

    // 3. Generate New Key (Random UUID)
    const newKey = `avatars/${cuid()}.webp`

    // 4. Upload to R2
    // We use 'put' because we have a raw buffer from Sharp, not a file stream
    await drive.use().put(newKey, processedBuffer, {
      contentType: 'image/webp',
      visibility: 'public',
    })

    // 5. Get the new Public URL
    const newUrl = await drive.use().getUrl(newKey)

    // 6. Cleanup Old Avatar (Fire and Forget strategy)
    // We don't await this because we don't want to block the response if deletion is slow
    if (user.avatarUrl) {
      this.deleteOldAvatar(user.avatarUrl).catch((err) => {
        logger.error({ err, userId: user.id }, 'Failed to delete old avatar')
      })
    }

    return newUrl
  }
}
