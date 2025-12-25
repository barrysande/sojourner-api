import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import { GroupSubscriptionService } from '#services/group_subscription_service'
import {
  createGroupSubscriptionValidator,
  joinGroupValidator,
  removeMemberValidator,
  changeSeatsValidator,
  changeGroupPlanValidator,
} from '#validators/subscription'
import { Exception } from '@adonisjs/core/exceptions'
import Plan from '#models/plan'

@inject()
export default class GroupSubscriptionsController {
  constructor(protected groupSubscriptionService: GroupSubscriptionService) {}

  async create({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const payload = await request.validateUsing(createGroupSubscriptionValidator)

    const result = await this.groupSubscriptionService.createGroupSubscription(user.id, payload)

    return response.created(result)
  }

  async changePlan({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const payload = await request.validateUsing(changeGroupPlanValidator)

    // Get plan by slug
    const plan = await Plan.query().where('slug', payload.plan_slug).firstOrFail()

    // Get owned group subscription
    const groupSubscription = await this.groupSubscriptionService.getOwnedGroupSubscription(user.id)

    // Derive plan type from slug (e.g., "group-monthly" -> "monthly")
    const planType = plan.slug.replace('group-', '') as 'monthly' | 'quarterly' | 'annual'

    // Construct params with addon from plan
    const params = {
      newProductId: plan.productId,
      quantity: payload.quantity,
      prorationBillingMode: payload.proration_billing_mode,
      addons: [
        {
          addon_id: plan.addonId,
          quantity: groupSubscription.totalSeats, // Keep existing seat count
        },
      ],
    }

    const result = await this.groupSubscriptionService.changeGroupSubscriptionPlan(
      groupSubscription.id,
      user.id,
      planType,
      params
    )

    return response.ok(result)
  }

  async expandSeats({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const payload = await request.validateUsing(changeSeatsValidator)

    const plan = await Plan.query().where('slug', payload.plan_slug).firstOrFail()

    const groupSubscription = await this.groupSubscriptionService.getOwnedGroupSubscription(user.id)

    const params = {
      newProductId: plan.productId,
      quantity: payload.quantity,
      prorationBillingMode: payload.proration_billing_mode,
      addons: [{ addon_id: plan.addonId, quantity: payload.new_seat_count }],
    }

    const result = await this.groupSubscriptionService.expandSeats(
      groupSubscription.id,
      user.id,
      params
    )

    return response.ok(result)
  }

  async reduceSeats({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const payload = await request.validateUsing(changeSeatsValidator)

    const plan = await Plan.query().where('slug', payload.plan_slug).firstOrFail()

    const groupSubscription = await this.groupSubscriptionService.getOwnedGroupSubscription(user.id)

    const params = {
      newProductId: plan.productId,
      quantity: payload.quantity,
      prorationBillingMode: payload.proration_billing_mode,
      addons: [{ addon_id: plan.addonId, quantity: payload.new_seat_count }],
    }

    const result = await this.groupSubscriptionService.reduceSeats(
      groupSubscription.id,
      user.id,
      params
    )

    return response.ok(result)
  }

  async cancel({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const ownedGroupSubscription = await this.groupSubscriptionService.getOwnedGroupSubscription(
      user.id
    )

    if (!ownedGroupSubscription.dodoSubscriptionId) {
      throw new Exception(
        `Missing dodoSubscriptionId for group subscription ${ownedGroupSubscription.id}`
      )
    }

    const result = await this.groupSubscriptionService.cancelGroupSubscription(
      ownedGroupSubscription.id,
      user.id
    )

    return response.ok(result)
  }

  async regenerateInviteCode({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const { inviteCode, expiresAt } =
      await this.groupSubscriptionService.regenerateInviteCodeForOwner(user.id)

    return response.ok({
      invite_code: inviteCode,
      expires_at: expiresAt.toISO(),
    })
  }

  async listMembers({ auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const members = await this.groupSubscriptionService.listGroupSubscriptionMembers(user.id)

      return response.ok({ members })
    } catch (error) {
      return response.internalServerError({
        message: 'Failed to load members',
      })
    }
  }

  async join({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const payload = await request.validateUsing(joinGroupValidator)

    const result = await this.groupSubscriptionService.joinGroupSubscription(
      user.id,
      payload.invite_code
    )

    return response.ok(result)
  }

  async removeMember({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const payload = await request.validateUsing(removeMemberValidator)

    await this.groupSubscriptionService.removeMemberFromSubscriptionGroup(
      user.id,
      payload.user_id_to_remove
    )

    return response.ok({ message: 'Member removed successfully' })
  }

  async show({ auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const result = await this.groupSubscriptionService.getActiveGroupMembership(user.id)

      return response.ok(result)
    } catch {
      return response.badRequest({ message: 'Failed to load subscription' })
    }
  }

  async getBillingDetails({ auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const context = await this.groupSubscriptionService.resolveGroupSubscriptionContext(user.id)

      return response.ok(context)
    } catch {
      return response.notFound({ message: 'No active group subscription found' })
    }
  }

  async getCustomerPortalLink({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const result = await this.groupSubscriptionService.getCustomerPortalLink(user.id)

    return response.ok(result)
  }

  async getSeatsInfo({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const groupSubscription = await this.groupSubscriptionService.getOwnedGroupSubscription(user.id)

    const seatsInfo = await this.groupSubscriptionService.getAvailableSeats(groupSubscription.id)

    return response.ok(seatsInfo)
  }
}
