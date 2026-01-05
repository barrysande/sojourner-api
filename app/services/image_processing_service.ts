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
}

interface UploadResult {
  storageKey: string
  thumbnailStorageKey: string
  fileSize: number
  width: number
  height: number
  mimeType: string
}

export default class ImageProcessingService {
  private readonly FULL_SIZE = 1200
  private readonly THUMB_SIZE = 400

  async processAndUpload(
    file: MultipartFile,
    userId: number,
    gemId: number
  ): Promise<UploadResult> {
    const keys = this.generateStorageKeys(userId, gemId)
    const disk = drive.use()

    const [fullImage, thumbImage] = await Promise.all([
      this.processImage(file, this.FULL_SIZE),
      this.generateThumbnail(file),
    ])

    await Promise.all([
      disk.put(keys.fullKey, fullImage.buffer, { contentType: 'image/webp' }),
      disk.put(keys.thumbKey, thumbImage.buffer, { contentType: 'image/webp' }),
    ])

    return {
      storageKey: keys.fullKey,
      thumbnailStorageKey: keys.thumbKey,
      fileSize: fullImage.metadata.size,
      width: fullImage.metadata.width,
      height: fullImage.metadata.height,
      mimeType: 'image/webp',
    }
  }

  async deleteUploadedFiles(keys: string[]): Promise<void> {
    if (keys.length === 0) return
    const disk = drive.use()

    await Promise.allSettled(keys.map((key) => disk.delete(key)))
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

  private async processImage(
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

  private async generateThumbnail(file: MultipartFile): Promise<ProcessedImage> {
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

  private generateStorageKeys(userId: number, gemId: number): ImagePaths {
    const uuid = cuid()
    const baseKey = `users/${userId}/gems/${gemId}/${uuid}`

    return {
      fullKey: `${baseKey}-full.webp`,
      thumbKey: `${baseKey}-thumb.webp`,
    }
  }
}
