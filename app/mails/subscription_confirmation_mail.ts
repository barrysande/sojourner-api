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

  from = `Hideouts <${env.get('MAIL_FROM_ADDRESS')}>`

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
The Hideouts Team
`
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <style>
    @media only screen and (max-width: 620px) {
      .email-container {
        width: 100% !important;
        max-width: 100% !important;
      }
      .email-content {
        padding: 24px !important;
      }
      .email-heading {
        font-size: 20px !important;
      }
      .email-text {
        font-size: 15px !important;
      }
      .footer-container {
        width: 100% !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif; background-color: #f4f4f7;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f4f4f7; padding: 20px;">
    <tr>
      <td align="center">
        <table class="email-container" width="600" border="0" cellspacing="0" cellpadding="0" style="width: 100%; max-width: 600px; background-color: #ffffff; border-radius: 8px; margin: 0 auto;">
          <tr>
            <td class="email-content" style="padding: 40px;">
              
              <h1 class="email-heading" style="font-size: 24px; font-weight: 600; color: #333; margin-top: 0;">${headline}</h1>
              
              <p class="email-text" style="font-size: 16px; line-height: 24px; color: #333;">
                Hi ${this.user.fullName},
              </p>
              
              <p class="email-text" style="font-size: 16px; line-height: 24px; color: #333;">
                ${bodyText}
              </p>
              
              <p class="email-text" style="font-size: 16px; line-height: 24px; color: #333;">
                You can now access all your new features. To manage your subscription, view invoices, or make any changes, please visit your account dashboard.
              </p>
              
              <table border="0" cellspacing="0" cellpadding="0" style="margin-top: 20px; width: 100%;">
                <tr>
                  <td align="center" style="background-color: #6a8259; border-radius: 4px;">
                    <a href="${frontendUrl}/dashboard"
                       target="_blank"
                       style="font-size: 16px; font-weight: 500; color: #ffffff; text-decoration: none; padding: 12px 25px; border: 1px solid #6a8259; display: inline-block; width: 100%; box-sizing: border-box; transition: background-color 0.2s ease;">
                      <!--[if mso]>
                      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${frontendUrl}/dashboard" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="10%" stroke="f" fillcolor="#6a8259">
                        <w:anchorlock/>
                        <center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:500;">Go to Your Dashboard</center>
                      </v:roundrect>
                      <![endif]-->
                      <!--[if !mso]><!-->
                      Go to Your Dashboard
                      <!--<![endif]-->
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        
        <table class="footer-container" width="600" border="0" cellspacing="0" cellpadding="0" style="width: 100%; max-width: 600px; margin: 0 auto;">
          <tr>
            <td align="center" style="padding: 30px 20px;">
              <p style="font-size: 12px; color: #999; margin: 0;">
                © ${DateTime.now().year} Hideouts. All rights reserved.<br/>
                You are receiving this email because you made a purchase on our platform.
              </p>
            </td>
          </tr>
        </table>
        
      </td>
    </tr>
  </table>
</body>
</html>
`
    this.message.to(this.user.email).html(htmlContent).text(textContent)
  }
}
