import sharp from 'sharp'
import { cuid } from '@adonisjs/core/helpers'
import { MultipartFile } from '@adonisjs/core/bodyparser'
import drive from '@adonisjs/drive/services/main'
import HiddenGem from '#models/hidden_gem'
import logger from '@adonisjs/core/services/logger'
import Photo from '#models/photo'

interface ProcessedImage {
  buffer: Buffer
  metadata: {
    width: number
    height: number
    size: number
    format: string
  }
}

interface ImagePaths {
  fullKey: string
  thumbKey: string
}

interface PhotoWithUrls {
  id: number
  storageKey: string
  thumbnailStorageKey: string
  url: string
  thumbnailUrl: string
  caption: string | null
  isPrimary: boolean
  fileSize: number
  mimeType: string
  width: number | null
  height: number | null
  createdAt: string | null
  updatedAt: string | null
}

export default class ImageProcessingService {
  private readonly ALLOWED_SUBTYPES = ['jpeg', 'jpg', 'png', 'webp']
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024
  private readonly FULL_SIZE = 1200
  private readonly THUMB_SIZE = 400

  validateImage(file: MultipartFile): { isValid: boolean; error?: string } {
    if (!file) {
      return { isValid: false, error: 'No file provided' }
    }

    const subtype = (file.subtype || '').toLowerCase()

    if (!this.ALLOWED_SUBTYPES.includes(subtype)) {
      return {
        isValid: false,
        error: `Invalid file type (${subtype}). Only JPEG, PNG, and WebP are allowed.`,
      }
    }

    if (file.size && file.size > this.MAX_FILE_SIZE) {
      return {
        isValid: false,
        error: `File size exceeds maximum of ${this.MAX_FILE_SIZE / 1024 / 1024}MB`,
      }
    }

    return { isValid: true }
  }

  /**
   * Process image: resize, compress, convert to WebP
   */
  async processImage(
    file: MultipartFile,
    maxSize: number = this.FULL_SIZE
  ): Promise<ProcessedImage> {
    try {
      const { data: buffer, info } = await sharp(file.tmpPath!)
        .resize(maxSize, maxSize, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true })

      return {
        buffer,
        metadata: {
          width: info.width,
          height: info.height,
          size: info.size,
          format: info.format,
        },
      }
    } catch (error) {
      logger.error('Image processing failed', { error: error.message })
      throw new Error('Failed to process image')
    }
  }

  /**
   * Generate thumbnail
   */
  async generateThumbnail(file: MultipartFile): Promise<ProcessedImage> {
    try {
      const { data: buffer, info } = await sharp(file.tmpPath!)
        .resize(this.THUMB_SIZE, this.THUMB_SIZE, {
          fit: 'cover',
        })
        .webp({ quality: 75 })
        .toBuffer({ resolveWithObject: true })

      return {
        buffer,
        metadata: {
          width: info.width,
          height: info.height,
          size: info.size,
          format: info.format,
        },
      }
    } catch (error) {
      logger.error('Thumbnail generation failed', { error: error.message })
      throw new Error('Failed to generate thumbnail')
    }
  }

  /**
   * Generate storage keys for R2
   */
  generateStorageKeys(userId: number, gemId: number): ImagePaths {
    const uuid = cuid()
    const baseKey = `users/${userId}/gems/${gemId}/${uuid}`

    return {
      fullKey: `${baseKey}-full.webp`,
      thumbKey: `${baseKey}-thumb.webp`,
    }
  }

  /**
   * Process and return both full and thumbnail buffers
   */
  async processAndSave(
    file: MultipartFile,
    userId: number,
    gemId: number
  ): Promise<{
    fullKey: string
    thumbKey: string
    fullBuffer: Buffer
    thumbBuffer: Buffer
    metadata: {
      width: number
      height: number
      size: number
      mimeType: string
    }
  }> {
    const keys = this.generateStorageKeys(userId, gemId)

    const fullImage = await this.processImage(file)

    const thumb = await this.generateThumbnail(file)

    return {
      fullKey: keys.fullKey,
      thumbKey: keys.thumbKey,
      fullBuffer: fullImage.buffer,
      thumbBuffer: thumb.buffer,
      metadata: {
        width: fullImage.metadata.width,
        height: fullImage.metadata.height,
        size: fullImage.metadata.size,
        mimeType: 'image/webp',
      },
    }
  }

  async getPhotoUrls(photos: Photo[]): Promise<PhotoWithUrls[]> {
    const disk = drive.use()

    return await Promise.all(
      photos.map(async (photo) => ({
        id: photo.id,
        storageKey: photo.storageKey,
        thumbnailStorageKey: photo.thumbnailStorageKey,
        url: await disk.getSignedUrl(photo.storageKey, { expiresIn: 86400 }),
        thumbnailUrl: await disk.getSignedUrl(photo.thumbnailStorageKey, { expiresIn: 86400 }),
        caption: photo.caption,
        isPrimary: photo.isPrimary,
        fileSize: photo.fileSize,
        mimeType: photo.mimeType,
        width: photo.width,
        height: photo.height,
        createdAt: photo.createdAt.toISO(),
        updatedAt: photo.updatedAt.toISO(),
      }))
    )
  }

  async deleteAllUserPhotos(userId: number): Promise<void> {
    const disk = drive.use()

    const gems = await HiddenGem.query().where('userId', userId).preload('photos')

    const allPhotos = gems.flatMap((gem) => gem.photos)

    await Promise.allSettled(
      allPhotos.map(async (photo) => {
        try {
          await disk.delete(photo.storageKey)
          await disk.delete(photo.thumbnailStorageKey)
        } catch (error) {
          logger.warn(
            { key: photo.storageKey, err: error },
            'Failed to delete gem photo during account destroy'
          )
        }
      })
    )
  }
}
