import router from '@adonisjs/core/services/router'
import { middleware } from './kernel.js'
import {
  registerThrottle,
  passwordResetThrottle,
  loginThrottle,
  resendVerifyEmailThrotte,
} from './limiter.js'
import AutoSwagger from 'adonis-autoswagger'
import swagger from '#config/swagger'

const AuthController = () => import('#controllers/auth_controller')
const SocialAuthsController = () => import('#controllers/social_auths_controller')
const HiddenGemsController = () => import('#controllers/hidden_gems_controller')
const ExpensesController = () => import('#controllers/expenses_controller')
const ShareGroupsController = () => import('#controllers/share_groups_controller')
const SharingController = () => import('#controllers/sharing_controller')
const NotificationsController = () => import('#controllers/notifications_controller')
const ChatsController = () => import('#controllers/chats_controller')
const WebhooksController = () => import('#controllers/webhooks_controller')
const IndividualSubscriptionsController = () =>
  import('#controllers/individual_subscriptions_controller')
const GroupSubscriptionsController = () => import('#controllers/group_subscriptions_controller')
const ProductsSyncController = () => import('#controllers/products_sync_controller')
const AdminAuthsController = () => import('#controllers/admin_auths_controller')
const PostVisitNotesController = () => import('#controllers/post_visit_notes_controller')
/*
  |----------------------------------------------------------
  | Users' Auth Routes
  |----------------------------------------------------------
  */
router
  .group(() => {
    router.post('/register', [AuthController, 'register']).use(registerThrottle)
    router.post('/login', [AuthController, 'login']).use(loginThrottle)
    router.post('/logout', [AuthController, 'logout']).use(middleware.auth())
    router.get('/me', [AuthController, 'me']).use(middleware.auth())
    router.patch('/change-password', [AuthController, 'changePassword']).use(middleware.auth())
    router.post('/forgot-password', [AuthController, 'forgotPassword']).use(passwordResetThrottle)
    router.post('/reset-password', [AuthController, 'resetPassword']).use(passwordResetThrottle)
    router.post('/verify-email', [AuthController, 'verifyEmail'])
    router
      .post('/resend-verification', [AuthController, 'resendEmailVerification'])
      .use(middleware.auth())
      .use(resendVerifyEmailThrotte)
    router.patch('/user/avatar', [AuthController, 'updateAvatar']).use(middleware.auth())
    router.delete('/user/account', [AuthController, 'deleteAccount']).use(middleware.auth())
  })
  .prefix('/auth')

/*
  |----------------------------------------------------------
  | Social Users' Auth Routes
  |----------------------------------------------------------
  */
router
  .group(() => {
    router.get('/google/redirect', [SocialAuthsController, 'redirect'])
    router.get('/google/callback', [SocialAuthsController, 'handleCallback'])
  })
  .prefix('/socialauth')

/*
  |----------------------------------------------------------
  | Admin Routes
  |----------------------------------------------------------
  */
router
  .group(() => {
    router
      .post('/sync-products', [ProductsSyncController, 'sync'])
      .use([middleware.auth(), middleware.isAdmin()])
    router.post('/register', [AdminAuthsController, 'register'])
    router.post('/login', [AdminAuthsController, 'login'])
    router
      .post('/logout', [AdminAuthsController, 'logout'])
      .use([middleware.auth(), middleware.isAdmin()])
    router.get('/me', [AdminAuthsController, 'me']).use([middleware.auth(), middleware.isAdmin()])
    router
      .post('/forgot-password', [AdminAuthsController, 'forgotPassword'])
      .use([middleware.auth(), middleware.isAdmin()])
    router
      .post('/reset-password', [AdminAuthsController, 'resetPassword'])
      .use([middleware.auth(), middleware.isAdmin()])
  })
  .prefix('/admin')

/*
  |----------------------------------------------------------
  | Hidden Gems Routes
  |----------------------------------------------------------
  */
router
  .group(() => {
    router.get('/hidden-gems', [HiddenGemsController, 'index'])
    router.get('/hidden-gems/:id', [HiddenGemsController, 'show'])
    router.post('/hidden-gems', [HiddenGemsController, 'store'])
    router.patch('/hidden-gems/:id', [HiddenGemsController, 'update'])
    router.delete('/hidden-gems/:id', [HiddenGemsController, 'destroy'])
    router.post('/hidden-gems/:id/photos', [HiddenGemsController, 'addPhotos'])
    router.delete('/hidden-gems/:id/photos/:photoId', [HiddenGemsController, 'deletePhoto'])

    router.get('/hidden-gems/:gemId/expenses', [ExpensesController, 'index'])
    router.get('/hidden-gems/:gemId/expenses/:expensesId', [ExpensesController, 'show'])
    router.post('/hidden-gems/:gemId/expenses', [ExpensesController, 'store'])
    router.patch('/hidden-gems/:gemId/expenses/:expenseId', [ExpensesController, 'update'])
    router.delete('/hidden-gems/:gemId/expenses/:expenseId', [ExpensesController, 'destroy'])

    router.get('/hidden-gems/:gemId/post-visit-notes', [PostVisitNotesController, 'index'])
    router.get('/hidden-gems/:gemId/post-visit-notes/:noteId', [PostVisitNotesController, 'show'])
    router.post('/hidden-gems/:gemId/post-visit-notes', [PostVisitNotesController, 'store'])
    router.patch('/hidden-gems/:gemId/post-visit-notes/:noteId', [
      PostVisitNotesController,
      'update',
    ])
    router.delete('/hidden-gems/:gemId/post-visit-notes/:noteId', [
      PostVisitNotesController,
      'destroy',
    ])
  })

  .prefix('api')
  .use(middleware.auth())

/*
  |----------------------------------------------------------
  | Share Groups Routes
  |----------------------------------------------------------
  */
router
  .group(() => {
    router.get('/share-groups', [ShareGroupsController, 'index'])
    router.post('/share-groups', [ShareGroupsController, 'store'])
    router.get('/share-groups/minimal', [ShareGroupsController, 'minimalShareGroups'])
    router.get('/share-groups/:id', [ShareGroupsController, 'show'])
    router.post('/share-groups/join', [ShareGroupsController, 'join'])
    router.post('/share-groups/:id/invite', [ShareGroupsController, 'invite'])
    router.delete('/share-groups/:id/leave', [ShareGroupsController, 'leave'])
    router.delete('/share-groups/:id', [ShareGroupsController, 'destroy'])
  })
  .prefix('/api')
  .use(middleware.auth())

/*
  |----------------------------------------------------------
  | Sharing Routes
  |----------------------------------------------------------
  */
router
  .group(() => {
    router.post('/share-groups/:id/gems', [SharingController, 'store'])
    router.delete('/share-groups/:id/gems', [SharingController, 'destroy'])
    router.get('/shared-gems', [SharingController, 'index'])
    router.get('/share-groups/:id/gems', [SharingController, 'showGroupGems'])
    router.post('/shared-gems/shared-status', [SharingController, 'sharedStatus'])
  })
  .prefix('/api')
  .use(middleware.auth())

/*
  |----------------------------------------------------------
  | Notifications Routes
  |----------------------------------------------------------
  */
router
  .group(() => {
    router.get('/notifications', [NotificationsController, 'index'])
    router.get('/notifications/unread-count', [NotificationsController, 'unreadCount'])
    router.get('/notifications/:id', [NotificationsController, 'show'])
    router.put('/notifications/:id/read', [NotificationsController, 'update'])
    router.put('/notifications/read-all', [NotificationsController, 'markAllRead'])
    router.delete('/notifications/:id', [NotificationsController, 'destroy'])
  })
  .prefix('/api')
  .use(middleware.auth())

/*
  |----------------------------------------------------------
  | Chat Routes
  |----------------------------------------------------------
  */
router
  .group(() => {
    router.get('/rooms', [ChatsController, 'getUserRooms'])
    router.get('/groups/:shareGroupId', [ChatsController, 'getGroupChatRoom'])
    router.get('/rooms/:roomId/messages', [ChatsController, 'getMessages'])
    router.delete('/messages/:messageId', [ChatsController, 'deleteMessage'])
    router.delete('/groups/:shareGroupId/my-messages', [ChatsController, 'deleteAllMyMessages'])
  })
  .prefix('/api/chat')
  .use(middleware.auth())

/*
  |----------------------------------------------------------
  | Subscription Routes
  |----------------------------------------------------------
  */
router
  .group(() => {
    router.post('/individual', [IndividualSubscriptionsController, 'create'])
    router.patch('/individual/plan', [IndividualSubscriptionsController, 'changePlan'])
    router.patch('/individual', [IndividualSubscriptionsController, 'cancel'])
    router.get('/individual', [IndividualSubscriptionsController, 'show'])
    router.get('/individual/customer-portal', [
      IndividualSubscriptionsController,
      'getCustomerPortalLink',
    ])

    router.post('/group', [GroupSubscriptionsController, 'create'])
    router.post('/group/seats/expand', [GroupSubscriptionsController, 'expandSeats'])
    router.post('/group/seats/reduce', [GroupSubscriptionsController, 'reduceSeats'])
    router.patch('/group/plan', [GroupSubscriptionsController, 'changePlan'])
    router.delete('/group/members/:userId', [GroupSubscriptionsController, 'removeMember'])
    router.patch('/group/cancel', [GroupSubscriptionsController, 'cancel'])
    router.post('/group/invite-code/regenerate', [
      GroupSubscriptionsController,
      'regenerateInviteCode',
    ])
    router.get('/group/members', [GroupSubscriptionsController, 'listMembers'])
    router.post('/group/join', [GroupSubscriptionsController, 'join'])
    router.get('/group', [GroupSubscriptionsController, 'show'])
    router.get('/group/customer-portal', [GroupSubscriptionsController, 'getCustomerPortalLink'])
    router.get('/group/billing', [GroupSubscriptionsController, 'getBillingDetails'])
    router.get('/products/change-subscription', [ProductsSyncController, 'index'])
    router.get('/group/seats', [GroupSubscriptionsController, 'getSeatsInfo'])
  })

  .prefix('api/subscriptions')
  .use(middleware.auth())
/*
  |----------------------------------------------------------
  | Webhook Routes
  |----------------------------------------------------------
  */
router.post('/webhooks/dodo', [WebhooksController, 'handle'])

/*
  |----------------------------------------------------------
  | Api docs Routes
  |----------------------------------------------------------
  */

// returns swagger in YAML
router.get('/swagger', async () => {
  return AutoSwagger.default.docs(router.toJSON(), swagger)
})

// Renders Swagger-UI and passes YAML-output of /swagger
router.get('/docs', async () => {
  return AutoSwagger.default.ui('/swagger', swagger)
  // return AutoSwagger.default.scalar("/swagger"); to use Scalar instead. If you want, you can pass proxy url as second argument here.
  // return AutoSwagger.default.rapidoc("/swagger", "view"); to use RapiDoc instead (pass "view" default, or "read" to change the render-style)
})
