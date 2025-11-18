import { BaseMail } from '@adonisjs/mail'
import User from '#models/user'
import env from '#start/env'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'

export default class SubscriptionConfirmationMail extends BaseMail {
  constructor(
    protected user: User,
    protected metadata: Record<string, any>
  ) {
    super()
  }

  from = `Sojourner <${env.get('MAIL_FROM_ADDRESS')}>`

  subject = 'Subscription Update'

  prepare() {
    const frontendUrl = env.get('FRONTEND_URL')
    const eventName = this.metadata.eventName as string

    let subjectLine: string
    let headline: string
    let bodyText: string

    switch (eventName) {
      case 'subscription.active':
        subjectLine = 'Subscription Active Confirmation!'
        headline = 'Your Subscription is Active!'
        bodyText =
          'Thank you for your payment! Your new subscription is now active. This email confirms your recent purchase.'
        break

      case 'subscription.renewed':
        subjectLine = 'Your Subscription Has Renewed'
        headline = 'Your Subscription Has Renewed'
        bodyText =
          'Thank you for your payment! Your subscription has successfully renewed for another billing period.'
        break

      case 'subscription.plan_changed':
        subjectLine = 'Your Subscription Plan Has Changed'
        headline = 'Your Plan Has Been Updated'
        bodyText = 'This email confirms that your subscription plan has been successfully changed.'
        break

      case 'subscription.cancelled':
        subjectLine = 'Your Subscription Has Been Cancelled'
        headline = 'Your Subscription is Cancelled'
        bodyText =
          'This email confirms that your subscription has been successfully cancelled. You will retain access until your billing period ends.'
        break

      case 'subscription.on_hold':
      case 'subscription.failed':
        subjectLine = 'Your Subscription Payment Failed'
        headline = 'Action Required: Payment Failed'
        bodyText =
          'We were unable to process the payment for your subscription. Your account may have limited access. Please update your payment method to restore full access.'
        break

      case 'subscription.expired':
        subjectLine = 'Your Subscription Has Expired'
        headline = 'Your Subscription Has Expired'
        bodyText =
          'Your subscription has expired and is no longer active. To regain access to your premium features, please resubscribe from your account dashboard.'
        break

      default:
        logger.warn(
          { eventName, userId: this.user.id },
          'Unhandled eventName in SubscriptionConfirmationMail, using default text.'
        )
        subjectLine = 'An Update on Your Subscription'
        headline = 'Your Subscription Has Been Updated'
        bodyText = 'This email is to confirm a recent update to your subscription status.'
        break
    }

    this.message.subject(subjectLine)

    const textContent = `
Hi ${this.user.fullName},

${bodyText}

You can now access all your new features. To manage your subscription or view invoices, please visit your account dashboard:
${frontendUrl}/dashboard

Thank you,
The Sojourner Team
`

    const htmlContent = `
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif; background-color: #f4f4f7;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f4f4f7; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" border="0" cellspacing="0" cellpadding="0" style="width: 600px; background-color: #ffffff; border-radius: 8px; margin: 0 auto;">
          <tr>
            <td style="padding: 40px;">
              
              <h1 style="font-size: 24px; font-weight: 600; color: #333; margin-top: 0;">${headline}</h1>
              
              <p style="font-size: 16px; line-height: 24px; color: #333;">
                Hi ${this.user.fullName},
              </p>
              
              <p style="font-size: 16px; line-height: 24px; color: #333;">
                ${bodyText}
              </p>
              
              <p style="font-size: 16px; line-height: 24px; color: #333;">
                You can now access all your new features. To manage your subscription, view invoices, or make any changes, please visit your account dashboard.
              </p>
              
              <table border="0" cellspacing="0" cellpadding="0" style="margin-top: 20px;">
                <tr>
                  <td align="center" style="background-color: #007bff; border-radius: 4px;">
                    <a href="${frontendUrl}/dashboard"
                       target="_blank"
                       style="font-size: 16px; font-weight: 500; color: #ffffff; text-decoration: none; padding: 12px 25px; border: 1px solid #007bff; display: inline-block;">
                      Go to Your Dashboard
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        
        <table width="600" border="0" cellspacing="0" cellpadding="0" style="width: 600px; margin: 0 auto;">
          <tr>
            <td align="center" style="padding: 30px 20px;">
              <p style="font-size: 12px; color: #999;">
                © ${DateTime.now().year} Sojourner. All rights reserved.<br/>
                You are receiving this email because you made a purchase on our platform.
            </td>
          </tr>
        </table>
        
      </td>
    </tr>
  </table>
</body>
`
    this.message.to(this.user.email).html(htmlContent).text(textContent)
  }
}
