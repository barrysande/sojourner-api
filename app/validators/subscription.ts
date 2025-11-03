import vine from '@vinejs/vine'

export const createIndividualSubscriptionValidator = vine.compile(
  vine.object({
    plan_type: vine.enum(['monthly', 'quarterly', 'annual']),
    product_id: vine.string().trim(),
    quantity: vine.number().min(1),
    customer: vine.object({
      email: vine.string().trim().email(),
      name: vine.string().trim().optional(),
      phone_number: vine.string().trim().optional(),
    }),
    billing: vine.object({
      street: vine.string().trim().minLength(1).maxLength(255),
      city: vine.string().trim().minLength(1).maxLength(100),
      state: vine.string().trim().minLength(1).maxLength(100),
      zipcode: vine.string().trim().minLength(1).maxLength(20),
      country: vine.string().trim().minLength(2).maxLength(2),
    }),
    metadata: vine.record(vine.any()).optional(),
    return_url: vine.string().trim().url().optional(),
    payment_link: vine.boolean().optional(),
    trial_period_days: vine.number().min(0).optional(),
  })
)

export const changeIndividualPlanValidator = vine.compile(
  vine.object({
    new_plan_type: vine.enum(['monthly', 'quarterly', 'annual']),
    new_product_id: vine.string().trim(),
    quantity: vine.number().min(1),
    proration_billing_mode: vine.literal('prorated_immediately'),
  })
)

export const createGroupSubscriptionValidator = vine.compile(
  vine.object({
    plan_type: vine.enum(['monthly', 'quarterly', 'annual']),
    product_id: vine.string().trim(),
    quantity: vine.number().min(1).max(100),
    customer: vine.object({
      email: vine.string().trim().email(),
      name: vine.string().trim().optional(),
      phone_number: vine.string().trim().optional(),
    }),
    billing: vine.object({
      street: vine.string().trim().minLength(1).maxLength(255),
      city: vine.string().trim().minLength(1).maxLength(100),
      state: vine.string().trim().minLength(1).maxLength(100),
      zipcode: vine.string().trim().minLength(1).maxLength(20),
      country: vine.string().trim().minLength(2).maxLength(2),
    }),
    metadata: vine.record(vine.any()).optional(),
    addons: vine
      .array(
        vine.object({
          addon_id: vine.string().trim(),
          quantity: vine.number().min(1),
        })
      )
      .optional(),
    return_url: vine.string().trim().url().optional(),
    payment_link: vine.boolean().optional(),
    trial_period_days: vine.number().min(0).optional(),
  })
)

export const joinGroupSubscriptionValidator = vine.compile(
  vine.object({
    invite_code: vine
      .string()
      .trim()
      .regex(
        /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/
      ),
  })
)

export const removeMemberValidator = vine.compile(
  vine.object({
    user_id: vine.number().positive(),
  })
)

export const changeSeatsValidator = vine.compile(
  vine.object({
    new_product_id: vine.string().trim(),
    quantity: vine.number().min(1).max(100),
    proration_billing_mode: vine.literal('prorated_immediately'),
    addons: vine
      .array(
        vine.object({
          addon_id: vine.string().trim(),
          quantity: vine.number().min(1),
        })
      )
      .optional(),
  })
)
