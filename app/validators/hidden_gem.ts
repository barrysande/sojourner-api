import vine from '@vinejs/vine'

export const createGemValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(255),
  location: vine.string().trim().minLength(1).maxLength(255),
  description: vine.string().trim(),
  photos: vine
    .array(
      vine.file({
        size: '15mb',
        extnames: ['jpg', 'jpeg', 'png', 'webp'],
      })
    )
    .minLength(1),
})

export const updateGemValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(255).optional(),
  location: vine.string().trim().minLength(1).maxLength(255).optional(),
  description: vine.string().trim().optional(),
  visited: vine
    .boolean()
    .optional()
    .transform((value) => value ?? false), //https://vinejs.dev/docs/html_forms_and_surprises -> Checkboxes are not booleans. This covers for when a user has switched off JS in browser, in which case the adonis will receive undefined, which not a true/safe boolean in this case. The database expects a true/false value and is notNullable. With JS on, Superforms sends a default false because of the bind:checked.
  rating: vine.number().min(1).max(5).optional(),
})

export const addGemPhotosValidator = vine.create({
  photos: vine
    .array(
      vine.file({
        size: '15mb',
        extnames: ['jpg', 'jpeg', 'png', 'webp'],
      })
    )
    .minLength(1),
})
