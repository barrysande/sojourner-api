import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, column, hasMany, hasOne } from '@adonisjs/lucid/orm'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import type { HasMany, HasOne } from '@adonisjs/lucid/types/relations'
import HiddenGem from './hidden_gem.js'
import SharedGem from './shared_gem.js'
import ShareGroup from './share_group.js'
import ShareGroupMember from './share_group_member.js'
import Notification from './notification.js'
import ChatMessage from './chat_message.js'
import IndividualSubscription from './individual_subscription.js'
import GroupSubscription from './group_subscription.js'
import GroupSubscriptionMember from './group_subscription_member.js'
import GracePeriod from './grace_period.js'
import TierAuditLog from './tier_audit_log.js'
import { DbRememberMeTokensProvider } from '@adonisjs/auth/session'

const AuthFinder = withAuthFinder(() => hash.use('scrypt'), {
  uids: ['email'],
  passwordColumnName: 'password',
})

export default class User extends compose(BaseModel, AuthFinder) {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare email: string

  @column({ serializeAs: null })
  declare password: string

  @column()
  declare fullName: string

  @column()
  declare tier: 'free' | 'individual_paid' | 'group_paid'

  @column.dateTime()
  declare tierUpdatedAt: DateTime | null

  @column.dateTime()
  declare emailVerifiedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  static rememberMeTokens = DbRememberMeTokensProvider.forModel(User)

  @hasMany(() => HiddenGem)
  declare hiddenGems: HasMany<typeof HiddenGem>

  @hasMany(() => SharedGem)
  declare sharedGems: HasMany<typeof SharedGem>

  @hasMany(() => ShareGroup, { foreignKey: 'createdBy' })
  declare createdShareGroups: HasMany<typeof ShareGroup>

  @hasMany(() => ShareGroupMember)
  declare shareGroupMemberships: HasMany<typeof ShareGroupMember>

  @hasMany(() => Notification)
  declare notifications: HasMany<typeof Notification>

  @hasMany(() => ChatMessage)
  declare chatMessage: HasMany<typeof ChatMessage>

  @hasOne(() => IndividualSubscription)
  declare individualSubscription: HasOne<typeof IndividualSubscription>

  @hasOne(() => GroupSubscription, { foreignKey: 'ownerUserId' })
  declare ownedGroupSubscription: HasOne<typeof GroupSubscription>

  @hasMany(() => GroupSubscriptionMember)
  declare groupSubscriptionMemberships: HasMany<typeof GroupSubscriptionMember>

  @hasMany(() => GracePeriod)
  declare gracePeriods: HasMany<typeof GracePeriod>

  @hasMany(() => TierAuditLog)
  declare tierAuditLogs: HasMany<typeof TierAuditLog>
}
