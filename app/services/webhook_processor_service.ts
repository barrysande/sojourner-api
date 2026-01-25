import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import User from '#models/user'
import WebhookEvent from '#models/webhook_event'
import IndividualSubscriptionService from './individual_subscription_service.js'
import { GroupSubscriptionService } from './group_subscription_service.js'
import IndividualSubscription from '#models/individual_subscription'
import GroupSubscriptionMember from '#models/group_subscription_member'
import GroupSubscription from '#models/group_subscription'
import { MissingSubscriptionFieldsException } from '#exceptions/payment_errors_exception'
import { resolvePlanType } from '../helpers/utils.js'
import { Exception } from '@adonisjs/core/exceptions'
import { DateTime } from 'luxon'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'

@inject()
export default class WebhookService {
  constructor(
    protected individualSubscriptionService: IndividualSubscriptionService,
    protected groupSubscriptionService: GroupSubscriptionService
  ) {}

  private async handleSubscriptionActive(
    webhookEvent: WebhookEvent,
    trx: TransactionClientContract
  ): Promise<User> {
    const payload = webhookEvent.payload
    const dodoSubId = payload.subscription_id
    const expiresAt = payload.expires_at
    const dodoCustomerId = payload.customer?.customer_id

    if (!dodoSubId || !expiresAt) {
      throw new MissingSubscriptionFieldsException()
    }

    if (!dodoCustomerId) {
      throw new Exception(`Missing customer_id for ${dodoSubId}`)
    }

    const subType = payload.metadata?.subscription_type
    const userId = Number(payload.metadata?.userId)
    const ownerUserId = Number(payload.metadata?.ownerUserId)

    if (subType === 'individual') {
      if (!userId) {
        throw new Exception(`Missing some subscription information`)
      }

      let subscription = await IndividualSubscription.query({ client: trx })
        .where('user_id', userId)
        .whereNull('dodoSubscriptionId')
        .first()

      if (!subscription) {
        logger.warn(`Orphan individual subscription found. Healing now: ${dodoSubId}`)
        subscription = await IndividualSubscription.create(
          {
            userId: userId,
            dodoSessionId: payload.session_id || 'unknown',
            dodoSubscriptionId: null,
            planType: resolvePlanType(
              payload.payment_frequency_count,
              payload.payment_frequency_interval
            ),
            status: 'pending',
          },
          { client: trx }
        )
      }

      await this.individualSubscriptionService.handleSubscriptionActive(
        userId,
        dodoSubId,
        dodoCustomerId,
        expiresAt,
        trx
      )

      return User.findOrFail(userId, { client: trx })
    } else if (subType === 'group') {
      if (!ownerUserId) {
        throw new Exception('Missing some subscription information')
      }

      let subscription = await GroupSubscription.query({ client: trx })
        .where('owner_user_id', ownerUserId)
        .whereNull('dodoSubscriptionId')
        .first()

      if (!subscription) {
        logger.warn(`Orphan group subscription found. Healing now: ${dodoSubId}`)

        // clear any zombie memberships/ownerships of a group before creating group subscription - corrective for deprecated removeFromExcessShareGroups()
        await GroupSubscriptionMember.query({ client: trx })
          .where('user_id', ownerUserId)
          .where('status', 'active')
          .update({ status: 'expired' })

        const totalSeats = payload.addons?.[0]?.quantity
        const inviteCode = await this.groupSubscriptionService.generateInviteCode()
        const inviteCodeExpiresAt = this.groupSubscriptionService.calculateInviteCodeExpiry()

        subscription = await GroupSubscription.create(
          {
            ownerUserId,
            dodoSessionId: payload.session_id || 'unknown',
            dodoSubscriptionId: null,
            totalSeats,
            inviteCode,
            inviteCodeExpiresAt,
            status: 'pending',
            planType: resolvePlanType(
              payload.payment_frequency_count,
              payload.payment_frequency_interval
            ),
          },
          { client: trx }
        )

        const existingMember = await GroupSubscriptionMember.query({ client: trx })
          .where('userId', ownerUserId)
          .where('status', 'active')
          .first()

        if (!existingMember) {
          await GroupSubscriptionMember.create(
            {
              groupSubscriptionId: subscription.id,
              userId: ownerUserId,
              joinedAt: DateTime.now(),
              status: 'active',
            },
            { client: trx }
          )
        }
      }

      await this.groupSubscriptionService.handleSubscriptionActive(
        ownerUserId,
        dodoSubId,
        dodoCustomerId,
        expiresAt,
        trx
      )

      return User.findOrFail(ownerUserId, { client: trx })
    } else {
      throw new Exception(`Unknown metadata.subscription_type: '${subType}'`)
    }
  }

  private async handleSubscriptionRenewed(
    webhookEvent: WebhookEvent,
    trx: TransactionClientContract
  ): Promise<User> {
    const payload = webhookEvent.payload
    const dodoSubId = payload.subscription_id
    const newExpiresAt = payload.expires_at
    const subType = payload.metadata?.subscription_type
    const userId = Number(payload.metadata?.userId)
    const ownerUserId = Number(payload.metadata?.ownerUserId)

    if (!dodoSubId || !newExpiresAt) {
      throw new MissingSubscriptionFieldsException()
    }

    if (subType === 'individual') {
      if (!userId) {
        throw new Exception(`Missing metadata.userId for ${dodoSubId}`)
      }
      await this.individualSubscriptionService.handleSubscriptionRenewed(
        userId,
        dodoSubId,
        newExpiresAt,
        trx
      )
      return User.findOrFail(userId, { client: trx })
    } else if (subType === 'group') {
      if (!ownerUserId) {
        throw new Exception(`Missing metadata.ownerUserId for ${dodoSubId}`)
      }
      await this.groupSubscriptionService.handleSubscriptionRenewed(
        ownerUserId,
        dodoSubId,
        newExpiresAt,
        trx
      )

      return User.findOrFail(ownerUserId, { client: trx })
    }
    throw new Exception(`Unknown subscription type: ${subType}`)
  }

  private async handleSubscriptionCancelled(
    webhookEvent: WebhookEvent,
    trx: TransactionClientContract
  ): Promise<User> {
    const payload = webhookEvent.payload
    const dodoSubId = payload.subscription_id
    const subType = payload.metadata?.subscription_type
    const userId = Number(payload.metadata?.userId)
    const ownerUserId = Number(payload.metadata?.ownerUserId)

    if (!dodoSubId) {
      throw new MissingSubscriptionFieldsException(`Missing required field: ${dodoSubId}`)
    }

    if (subType === 'individual') {
      if (!userId) {
        throw new Exception(`Missing metadata.userId for ${dodoSubId}`)
      }
      await this.individualSubscriptionService.handleSubscriptionCancelled(userId, dodoSubId, trx)
      return User.findOrFail(userId, { client: trx })
    } else if (subType === 'group') {
      if (!ownerUserId) {
        throw new Exception(`Missing metadata.ownerUserId for ${dodoSubId}`)
      }
      await this.groupSubscriptionService.handleSubscriptionCancelled(ownerUserId, dodoSubId, trx)
      return User.findOrFail(ownerUserId, { client: trx })
    }
    throw new Exception(`Unknown subscription type: ${subType}`)
  }

  private async handleSubscriptionExpired(
    webhookEvent: WebhookEvent,
    trx: TransactionClientContract
  ): Promise<User> {
    const payload = webhookEvent.payload
    const dodoSubId = payload.subscription_id
    const subType = payload.metadata?.subscription_type
    const userId = Number(payload.metadata?.userId)
    const ownerUserId = Number(payload.metadata?.ownerUserId)

    if (!dodoSubId) {
      throw new MissingSubscriptionFieldsException(`Missing required field: ${dodoSubId}`)
    }

    if (subType === 'individual') {
      if (!userId) {
        throw new Exception(`Missing metadata.userId for ${dodoSubId}`)
      }
      await this.individualSubscriptionService.handleSubscriptionExpired(userId, dodoSubId, trx)
      return User.findOrFail(userId, { client: trx })
    } else if (subType === 'group') {
      if (!ownerUserId) {
        throw new Exception(`Missing metadata.ownerUserId for ${dodoSubId}`)
      }
      await this.groupSubscriptionService.handleSubscriptionExpired(ownerUserId, dodoSubId, trx)
      return User.findOrFail(ownerUserId, { client: trx })
    }
    throw new Exception(`Unknown subscription type: ${subType}`)
  }

  private async handleSubscriptionFailed(
    webhookEvent: WebhookEvent,
    trx: TransactionClientContract
  ): Promise<User> {
    const payload = webhookEvent.payload
    const dodoSubId = payload.subscription_id
    const subType = payload.metadata?.subscription_type
    const userId = Number(payload.metadata?.userId)
    const ownerUserId = Number(payload.metadata?.ownerUserId)

    if (!dodoSubId) {
      throw new MissingSubscriptionFieldsException(`Missing required field: ${dodoSubId}`)
    }

    if (subType === 'individual') {
      if (!userId) {
        throw new Exception(`Missing metadata.userId for ${dodoSubId}`)
      }
      await this.individualSubscriptionService.handleSubscriptionFailed(userId, dodoSubId, trx)
      return User.findOrFail(userId, { client: trx })
    } else if (subType === 'group') {
      if (!ownerUserId) {
        throw new Exception(`Missing metadata.ownerUserId for ${dodoSubId}`)
      }
      await this.groupSubscriptionService.handleSubscriptionFailed(ownerUserId, dodoSubId, trx)
      return User.findOrFail(ownerUserId, { client: trx })
    }
    throw new Exception(`Unknown subscription type: ${subType}`)
  }

  private async handleSubscriptionPlanChanged(
    webhookEvent: WebhookEvent,
    trx: TransactionClientContract
  ): Promise<User> {
    const payload = webhookEvent.payload
    const dodoSubId = payload.subscription_id
    const subType = payload.metadata?.subscription_type
    const userId = Number(payload.metadata?.userId)
    const ownerUserId = Number(payload.metadata?.ownerUserId)
    const newQuantity = payload.addons?.[0]?.quantity

    if (!dodoSubId) {
      throw new MissingSubscriptionFieldsException('Missing required field: subscriptionId')
    }

    const planType = resolvePlanType(
      payload.payment_frequency_count,
      payload.payment_frequency_interval
    )

    if (subType === 'individual') {
      if (!userId) {
        throw new Exception(`Missing metadata.userId for ${dodoSubId}`)
      }
      await this.individualSubscriptionService.handleSubscriptionPlanChanged(
        userId,
        dodoSubId,
        planType,
        payload.expires_at!,
        trx
      )
      return User.findOrFail(userId, { client: trx })
    } else if (subType === 'group') {
      if (!ownerUserId) {
        throw new Exception(`Missing metadata.ownerUserId for ${dodoSubId}`)
      }
      await this.groupSubscriptionService.handleSubscriptionPlanChanged(
        ownerUserId,
        dodoSubId,
        newQuantity || 1,
        planType,
        trx
      )

      return User.findOrFail(ownerUserId, { client: trx })
    }
    throw new Exception(`Unknown subscription type: ${subType}`)
  }

  async processWebhookEvent(
    webhookEvent: WebhookEvent,
    trx: TransactionClientContract
  ): Promise<User | void> {
    logger.info('Processing webhook event', {
      eventId: webhookEvent.eventId,
      eventType: webhookEvent.eventType,
    })

    let user: User | void

    switch (webhookEvent.eventType) {
      case 'subscription.active':
        user = await this.handleSubscriptionActive(webhookEvent, trx)
        break

      case 'subscription.renewed':
        user = await this.handleSubscriptionRenewed(webhookEvent, trx)
        break

      case 'subscription.cancelled':
        user = await this.handleSubscriptionCancelled(webhookEvent, trx)
        break
      case 'subscription.expired':
        user = await this.handleSubscriptionExpired(webhookEvent, trx)
        break
      case 'subscription.failed':
      case 'subscription.on_hold':
        user = await this.handleSubscriptionFailed(webhookEvent, trx)
        break
      case 'subscription.plan_changed':
        user = await this.handleSubscriptionPlanChanged(webhookEvent, trx)
        break
      default:
        logger.warn('Unknown webhook event type', {
          eventId: webhookEvent.eventId,
          eventType: webhookEvent.eventType,
        })
        user = undefined
        break
    }

    return user
  }
}
