import vine from '@vinejs/vine'

export const hiddenGemWithPhotosValidator = vine.compile(
  vine.object({
    name: vine.string().minLength(1).maxLength(255),
    location: vine.string().minLength(1).maxLength(255),
    description: vine.string().optional(),
    latitude: vine.number().optional(),
    longitude: vine.number().optional(),
    photos: vine
      .array(
        vine.object({
          url: vine.string().url(),
          secure_url: vine.string().url(),
          public_id: vine.string().minLength(1),
          original_filename: vine.string().optional(),
          caption: vine.string().optional(),
        })
      )
      .optional(),
  })
)
