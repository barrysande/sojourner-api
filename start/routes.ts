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
import { registerThrottle, passwordResetThrottle } from './limiter.js'
const AuthController = () => import('#controllers/auth_controller')
const HiddenGemsController = () => import('#controllers/hidden_gems_controller')
const ExpensesController = () => import('#controllers/expenses_controller')

// router.get('/', async () => {
//   return {
//     hello: 'world',
//   }
// })

// AUTH ROUTES
router
  .group(() => {
    router.post('/register', [AuthController, 'register']).use(registerThrottle)
    router.post('/login', [AuthController, 'login'])
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
  .use(middleware.auth())
