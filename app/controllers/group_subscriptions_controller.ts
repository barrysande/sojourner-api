import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import { GroupSubscriptionService } from '#services/group_subscription_service'
import { DateTime } from 'luxon'
import {
  createGroupSubscriptionValidator,
  joinGroupValidator,
  removeMemberValidator,
  changeSeatsValidator,
  regenerateInviteCodeValidator,
} from '#validators/subscription'
import { Exception } from '@adonisjs/core/exceptions'

@inject()
export default class GroupSubscriptionsController {
  constructor(protected groupSubscriptionService: GroupSubscriptionService) {}

  async create({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const payload = await request.validateUsing(createGroupSubscriptionValidator)

    const result = await this.groupSubscriptionService.createGroupSubscription(user.id, payload)

    return response.created(result)
  }

  async expandSeats({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const payload = await request.validateUsing(changeSeatsValidator)

    const params = {
      newProductId: payload.new_product_id,
      quantity: payload.quantity,
      prorationBillingMode: payload.proration_billing_mode,
      addons: payload.addons || [],
    }

    const result = await this.groupSubscriptionService.expandSeats(
      payload.group_subscription_id,
      user.id,
      params
    )

    return response.ok(result)
  }

  async reduceSeats({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const payload = await request.validateUsing(changeSeatsValidator)

    const params = {
      newProductId: payload.new_product_id,
      quantity: payload.quantity,
      prorationBillingMode: payload.proration_billing_mode,
      addons: payload.addons || [],
    }

    const result = await this.groupSubscriptionService.reduceSeats(
      payload.group_subscription_id,
      user.id,
      params
    )

    return response.ok(result)
  }

  async removeMember({ auth, request, response }: HttpContext) {
    const user = await auth.getUserOrFail()

    const payload = await request.validateUsing(removeMemberValidator)

    await this.groupSubscriptionService.removeMemberFromSubscriptionGroup(
      payload.group_subscription_id,
      payload.user_id_to_remove,
      user.id
    )

    return response.ok({ message: 'Member removed successfully' })
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

  async regenerateInviteCode({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const payload = await request.validateUsing(regenerateInviteCodeValidator)

    const newInviteCode = await this.groupSubscriptionService.regenerateInviteCode(
      payload.group_subscription_id,
      user.id
    )

    return response.ok({
      invite_code: newInviteCode,
      expires_at: DateTime.now().plus({ days: 30 }).toISO(),
    })
  }

  async listMembers({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const members = await this.groupSubscriptionService.listGroupSubscriptionMembers(user.id)
    return response.ok({ members })
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

  async show({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const result = await this.groupSubscriptionService.getActiveGroupMembership(user.id)

    return response.ok(result)
  }

  async getCustomerPortalLink({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const result = await this.groupSubscriptionService.getCustomerPortalLink(user.id)
    return response.ok(result)
  }
}
