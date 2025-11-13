// import { v2 as cloudinary } from 'cloudinary'
// import env from '#start/env'
// import logger from '@adonisjs/core/services/logger'

// export default class CloudinaryService {
//   constructor() {
//     cloudinary.config({
//       cloud_name: env.get('CLOUDINARY_CLOUD_NAME'),
//       api_key: env.get('CLOUDINARY_API_KEY'),
//       api_secret: env.get('CLOUDINARY_API_SECRET'),
//       secure: true,
//     })
//   }

//   async validateCloudinaryUrl(url: string): Promise<boolean> {
//     try {
//       const cloudName = env.get('CLOUDINARY_CLOUD_NAME')
//       if (!cloudName) {
//         logger.error('CLOUDINARY_CLOUD_NAME not found in environment')
//         return false
//       }
//       const expectedDomain = `res.cloudinary.com/${cloudName}/`
//       return url.includes(expectedDomain)
//     } catch (error) {
//       logger.error('Error validating Cloudinary URL', {
//         url: url?.substring(0, 50),
//         error: error.message,
//       })
//       return false
//     }
//   }

//   async validateCloudinaryResponse(data: any): Promise<boolean> {
//     try {
//       const requiredFields = ['url', 'secure_url', 'public_id']
//       const hasAllFields = requiredFields.every((field) => {
//         return data[field] !== undefined && data[field] !== ''
//       })

//       const isValidUrl = await this.validateCloudinaryUrl(data.url)
//       const isValidSecureUrl = await this.validateCloudinaryUrl(data.secure_url)

//       return hasAllFields && isValidUrl && isValidSecureUrl
//     } catch (error) {
//       logger.error('Error validating Cloudinary response', {
//         error: error.message,
//       })
//       return false
//     }
//   }

//   getUploadPreset(userTier: string): string {
//     switch (userTier) {
//       case 'free':
//         return env.get('CLOUDINARY_FREE_PRESET')
//       case 'individual_paid':
//       case 'group_paid':
//         return env.get('CLOUDINARY_PAID_PRESET')
//       default:
//         return env.get('CLOUDINARY_FREE_PRESET')
//     }
//   }

//   async deleteImage(publicId: string): Promise<{ success: boolean; error?: string }> {
//     try {
//       const result = await cloudinary.uploader.destroy(publicId)
//       const success = result.result === 'ok'

//       if (success) {
//         logger.info('Cloudinary image deleted successfully', {
//           publicId,
//           result: result.result,
//         })
//         return { success: true }
//       } else {
//         logger.warn('Cloudinary deletion returned non-OK result', {
//           publicId,
//           result: result.result,
//         })
//         return { success: false, error: `Deletion failed: ${result.result}` }
//       }
//     } catch (error) {
//       logger.error('Cloudinary image deletion failed', {
//         publicId,
//         error: error.message,
//         errorCode: error.code,
//       })
//     }
//     return { success: false, error: 'Failed to delete image' }
//   }

//   generateSignedUploadParams(userTier: string, userId: number, gemId?: number) {
//     if (!userId || !userTier) {
//       throw new Error('Missing required parameters for upload configuration.')
//     }

//     try {
//       const uploadPreset = this.getUploadPreset(userTier)
//       const timestamp = Math.round(new Date().getTime() / 1000)

//       const folder = gemId ? `users/${userId}/gems/${gemId}` : `users/${userId}/temp`

//       const params = {
//         upload_preset: uploadPreset,
//         timestamp: timestamp,
//         folder: folder,
//       }

//       const signature = cloudinary.utils.api_sign_request(params, env.get('CLOUDINARY_API_SECRET'))

//       return {
//         ...params,
//         signature,
//         api_key: env.get('CLOUDINARY_API_KEY'),
//         cloud_name: env.get('CLOUDINARY_CLOUD_NAME'),
//       }
//     } catch (error) {
//       logger.error('Failed to generate Cloudinary upload parameters', {
//         error: error.message,
//       })
//       throw new Error('Unable to configure photo upload,')
//     }
//   }

//   async deleteMultipleImages(publicIds: string[]): Promise<{
//     successful: string[]
//     failed: { publicId: string; error: string }[]
//   }> {
//     const successful: string[] = []
//     const failed: { publicId: string; error: string }[] = []
//     for (const publicId of publicIds) {
//       const result = await this.deleteImage(publicId)

//       if (result.success) {
//         successful.push(publicId)
//       } else {
//         failed.push({ publicId, error: result.error || 'Unknown Error' })
//       }
//     }

//     logger.info('Bulk Cloudinary deletion completed', {
//       total: publicIds.length,
//       successful: successful.length,
//       failed: failed.length,
//     })

//     return { successful, failed }
//   }
// }
