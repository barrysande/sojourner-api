import sharp from 'sharp'
import drive from '@adonisjs/drive/services/main'
import { cuid } from '@adonisjs/core/helpers'
import { MultipartFile } from '@adonisjs/core/bodyparser'
import logger from '@adonisjs/core/services/logger'
import User from '#models/user'

export default class AvatarService {
  private readonly AVATAR_SIZE = 400

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
   * Delete the avatar by key
   */
  private async deleteOldAvatar(key: string): Promise<void> {
    try {
      if (key.startsWith('avatars/')) {
        await drive.use().delete(key)
      }
    } catch (error) {
      // Log the error but don't throw because failure to delete an old photo in this case is not a user error.
      logger.warn({ key, err: error }, 'Could not extract key or delete old avatar')
    }
  }

  /**
   * Delete avatar by key for account deletion
   */
  async deleteAvatar(key: string | null): Promise<void> {
    if (!key) return

    try {
      if (key.startsWith('avatars/')) {
        await drive.use().delete(key)
        logger.info({ key }, 'Avatar deleted from R2')
      }
    } catch (error) {
      // Log the error but don't throw because any missing file should not stop the account deletion.
      logger.warn({ key, err: error }, 'Failed to delete avatar file')
    }
  }

  /**
   * Get avatar URL - returns presigned URL for uploaded avatars, direct URL for social
   */
  async getAvatarUrl(user: User): Promise<string | null> {
    if (!user.avatarKey && !user.avatarUrl) return null

    if (user.avatarSource === 'social') {
      return user.avatarUrl
    }

    return await drive.use().getSignedUrl(user.avatarKey!, { expiresIn: 3600 })
  }

  /**
   * Main entry point: Validates, Processes, Uploads, and cleans up old avatar
   */
  async updateAvatar(user: User, file: MultipartFile): Promise<string> {
    const processedBuffer = await this.processImage(file)

    const newKey = `avatars/${cuid()}.webp`

    await drive.use().put(newKey, processedBuffer, {
      contentType: 'image/webp',
    })

    if (user.avatarKey) {
      this.deleteOldAvatar(user.avatarKey).catch((err) => {
        logger.error({ err, userId: user.id }, 'Failed to delete old avatar')
      })
    }

    return newKey
  }
}
