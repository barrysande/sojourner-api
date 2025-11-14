import sharp from 'sharp'
import { cuid } from '@adonisjs/core/helpers'
import { MultipartFile } from '@adonisjs/core/bodyparser'
import logger from '@adonisjs/core/services/logger'

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

export default class ImageProcessingService {
  private readonly ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB (will be validated per tier)
  private readonly FULL_SIZE = 1200
  private readonly THUMB_SIZE = 400

  /**
   * Validate image file
   */
  validateImage(file: MultipartFile): { isValid: boolean; error?: string } {
    if (!file) {
      return { isValid: false, error: 'No file provided' }
    }

    if (!this.ALLOWED_TYPES.includes(file.type || '')) {
      return {
        isValid: false,
        error: 'Invalid file type. Only JPEG, PNG, and WebP are allowed.',
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
    // Generate storage keys
    const keys = this.generateStorageKeys(userId, gemId)

    // Process full image
    const full = await this.processImage(file)

    // Process thumbnail
    const thumb = await this.generateThumbnail(file)

    return {
      fullKey: keys.fullKey,
      thumbKey: keys.thumbKey,
      fullBuffer: full.buffer,
      thumbBuffer: thumb.buffer,
      metadata: {
        width: full.metadata.width,
        height: full.metadata.height,
        size: full.metadata.size,
        mimeType: 'image/webp',
      },
    }
  }
}
