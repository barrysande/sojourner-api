/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import { middleware } from './kernel.js'
import { registerThrottle, passwordResetThrottle, loginThrottle } from './limiter.js'
const AuthController = () => import('#controllers/auth_controller')
const HiddenGemsController = () => import('#controllers/hidden_gems_controller')
const ExpensesController = () => import('#controllers/expenses_controller')
const ShareGroupsController = () => import('#controllers/share_groups_controller')
const SharingController = () => import('#controllers/sharing_controller')
const NotificationsController = () => import('#controllers/notifications_controller')
const ChatsController = () => import('#controllers/chats_controller')

// router.get('/', async () => {
//   return {
//     hello: 'world',
//   }
// })

// AUTH ROUTES
router
  .group(() => {
    router.post('/register', [AuthController, 'register']).use(registerThrottle)
    router.post('/login', [AuthController, 'login']).use(loginThrottle)
    router.post('/logout', [AuthController, 'logout']).use(middleware.auth())
    router.get('/me', [AuthController, 'me']).use(middleware.auth())
    router.patch('/change-password', [AuthController, 'changePassword']).use(middleware.auth())
    router.post('/forgot-password', [AuthController, 'forgotPassword']).use(passwordResetThrottle)
    router.post('/reset-password', [AuthController, 'resetPassword']).use(passwordResetThrottle)
  })
  .prefix('/auth')

// HIDDEN GEMS ROUTES
router
  .group(() => {
    router.get('/hidden-gems', [HiddenGemsController, 'index'])
    router.get('/hidden-gems/:id', [HiddenGemsController, 'show'])
    router.post('/hidden-gems', [HiddenGemsController, 'store'])
    router.put('/hidden-gems/:id', [HiddenGemsController, 'update'])
    router.delete('/hidden-gems/:id', [HiddenGemsController, 'destroy'])
    router.post('/hidden-gems/:id/photos', [HiddenGemsController, 'addPhotos'])
    router.delete('/hidden-gems/:id/photos/:photoId', [HiddenGemsController, 'deletePhoto'])

    // Expenses
    router.get('/hidden-gems/:gemId/expenses', [ExpensesController, 'index'])
    router.get('/hidden-gems/:gemId/expenses/:expensesId', [ExpensesController, 'show'])
    router.post('/hidden-gems/:gemId/expenses', [ExpensesController, 'store'])
    router.put('/hidden-gems/:gemId/expenses/:expenseId', [ExpensesController, 'update'])
    router.delete('/hidden-gems/:gemId/expenses/:expenseId', [ExpensesController, 'destroy'])
  })
  .prefix('api')
  .use([middleware.requestTimeout({ timeout: 10000 }), middleware.auth()])

// SHARE GROUPS ROUTES
router
  .group(() => {
    router.get('/share-groups', [ShareGroupsController, 'index'])
    router.post('/share-groups', [ShareGroupsController, 'store'])
    router.get('/share-groups/:id', [ShareGroupsController, 'show'])
    router.post('/share-groups/join', [ShareGroupsController, 'join'])
    router.post('/share-groups/:id/invite', [ShareGroupsController, 'invite'])
    router.delete('/share-groups/:id/leave', [ShareGroupsController, 'leave'])
    router.delete('/share-groups/:id', [ShareGroupsController, 'destroy'])
  })
  .prefix('/api')
  .use([middleware.auth(), middleware.requestTimeout({ timeout: 10000 })])

// SHARING ROUTES
router
  .group(() => {
    router.post('/share-groups/:id/gems', [SharingController, 'store'])
    router.delete('/share-groups/:id/gems', [SharingController, 'destroy'])
    router.get('/shared-gems', [SharingController, 'index'])
    router.get('/share-groups/:id/gems', [SharingController, 'showGroupGems'])
  })
  .prefix('/api')
  .use([middleware.auth(), middleware.requestTimeout({ timeout: 10000 })])

// NOTIFICATIONS ROUTES
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

// CHAT ROUTES
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
