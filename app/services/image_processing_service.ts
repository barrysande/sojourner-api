import sharp from 'sharp'
import { cuid } from '@adonisjs/core/helpers'
import { MultipartFile } from '@adonisjs/core/bodyparser'
import app from '@adonisjs/core/services/app'
import { unlink, writeFile } from 'node:fs/promises'
import logger from '@adonisjs/core/services/logger'
import { Exception } from '@adonisjs/core/exceptions'

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
  fullPath: string
  thumbPath: string
  fullKey: string
  thumbKey: string
}

export default class ImageProcessingService {
  private readonly ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024
  private readonly FULL_SIZE = 1200
  private readonly THUMB_SIZE = 400

  validateImage(file: MultipartFile): { isValid: boolean; error?: string } {
    if (!file) {
      return {
        isValid: false,
        error: 'No file provided.',
      }
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
    return {
      isValid: true,
    }
  }

  async processImage(
    file: MultipartFile,
    maxSize: number = this.FULL_SIZE
  ): Promise<ProcessedImage> {
    try {
      const buffer = await sharp(file.tmpPath)
        .resize(maxSize, maxSize, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer()

      const metadata = await sharp(buffer).metadata()

      return {
        buffer,
        metadata: {
          width: metadata.width,
          height: metadata.height,
          size: buffer.length,
          format: 'webp',
        },
      }
    } catch (error) {
      logger.error('Image processing failed', { error: error.message })
      throw new Exception('Failed to process image', {
        code: 'E_IMAGE_PROCESSING_FAILED',
        status: 400,
      })
    }
  }

  async generateThumbnail(file: MultipartFile): Promise<ProcessedImage> {
    try {
      const buffer = await sharp(file.tmpPath)
        .resize(this.THUMB_SIZE, this.THUMB_SIZE, {
          fit: 'cover',
          position: 'center',
        })
        .webp({ quality: 75 })
        .toBuffer()

      const metadata = await sharp(buffer).metadata()

      return {
        buffer,
        metadata: {
          width: metadata.width,
          height: metadata.height,
          size: buffer.length,
          format: 'webp',
        },
      }
    } catch (error) {
      logger.error('Thumbnail generation failed', { error: error.message })
      throw new Exception('Failed to generate thumbnail', {
        code: 'E_THUMBNAIL_GENERATE_FAILED',
        status: 400,
      })
    }
  }

  generateStorageKeys(userId: number, gemId: number): ImagePaths {
    const uuid = cuid()
    const baseKey = `users/${userId}/gems/${gemId}/${uuid}`

    return {
      fullPath: '',
      thumbPath: '',
      fullKey: `${baseKey}-full.webp`,
      thumbKey: `${baseKey}-thumb.webp`,
    }
  }

  async saveTempFile(buffer: Buffer, filename: string): Promise<string> {
    const tmpPath = app.tmpPath(`uploads/${filename}`)
    await writeFile(tmpPath, buffer)
    return tmpPath
  }

  async deleteTempFiles(paths: string[]): Promise<void> {
    for (const path of paths) {
      try {
        await unlink(path)
      } catch (error) {
        logger.warn('Failed to delete temp file', { path, error: error.message })
      }
    }
  }

  async processAndSave(
    file: MultipartFile,
    userId: number,
    gemId: number
  ): Promise<{
    fullKey: string
    thumbKey: string
    fullPath: string
    thumbPath: string
    metadata: {
      width: number
      height: number
      size: number
      mimeType: string
    }
  }> {
    // 1. Generate storage keys
    const keys = this.generateStorageKeys(userId, gemId)

    // 2. Process full image
    const full = await this.processImage(file)
    const fullPath = await this.saveTempFile(full.buffer, `${cuid()}-full.webp`)

    // 3. Process thumbnail
    const thumb = await this.generateThumbnail(file)
    const thumbPath = await this.saveTempFile(thumb.buffer, `${cuid()}-thumb.webp`)

    return {
      fullKey: keys.fullKey,
      thumbKey: keys.thumbKey,
      fullPath,
      thumbPath,
      metadata: {
        width: full.metadata.width,
        height: full.metadata.height,
        size: full.metadata.size,
        mimeType: 'image/webp',
      },
    }
  }
}
