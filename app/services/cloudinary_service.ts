import { v2 as cloudinary } from 'cloudinary'
import env from '#start/env'

export default class CloudinaryService {
  constructor() {
    cloudinary.config({
      cloud_name: env.get('CLOUDINARY_CLOUD_NAME'),
      api_key: env.get('CLOUDINARY_API_KEY'),
      api_secret: env.get('CLOUDINARY_API_SECRET'),
      secure: true,
    })
  }

  validateCloudinaryUrl(url: string): boolean {
    const cloudName = env.get('CLOUDINARY_CLOUD_NAME')
    const expectedDomain = `res.cloudinary.com/${cloudName}/`
    return url.includes(expectedDomain)
  }

  validateCloudinaryResponse(data: any): boolean {
    const requiredFields = ['url', 'secure_url', 'public_id']
    const hasAllFields = requiredFields.every((field) => {
      data[field] !== undefined && data[field] !== ''
    })

    const isValidUrl = this.validateCloudinaryUrl(data.url)
    const isValidSecureUrl = this.validateCloudinaryUrl(data.secure_url)
    return hasAllFields && isValidUrl && isValidSecureUrl
  }

  getUploadPreset(userTier: string): string {
    switch (userTier) {
      case 'free':
        return env.get('CLOUDINARY_FREE_PRESET')
      case 'individual_paid':
      case 'group_paid':
        return env.get('CLOUDINARY_PAID_PRESET')
      default:
        return env.get('CLOUDINARY_FREE_PRESET')
    }
  }

  async deleteImage(publicId: string): Promise<boolean> {
    try {
      const result = await cloudinary.uploader.destroy(publicId)
      return result.result === 'ok'
    } catch (error) {
      console.error('Error deleting image from Cloudinary:', error)
      return false
    }
  }

  generateSignedUploadParams(userTier: string, userId: number, gemId?: number) {
    const uploadPreset = this.getUploadPreset(userTier)
    const timestamp = Math.round(new Date().getTime() / 1000)

    const folder = gemId ? `users/${userId}/gems/${gemId}` : `users/${userId}/temp`
    const params = {
      upload_preset: uploadPreset,
      timestamp: timestamp,
      folder: folder,
    }

    const signature = cloudinary.utils.api_sign_request(params, env.get('CLOUDINARY_API_SECRET'))

    return {
      ...params,
      signature,
      api_key: env.get('CLOUDINARY_API_KEY'),
      cloud_name: env.get('CLOUDINARY_CLOUD_NAME'),
    }
  }
}
