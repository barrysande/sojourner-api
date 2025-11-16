import { BaseMail } from '@adonisjs/mail'
import User from '#models/user'
import env from '#start/env'
import { DateTime } from 'luxon'

export default class SubscriptionConfirmationMail extends BaseMail {
  constructor(protected user: User) {
    super()
  }

  from = `Sojourner <${env.get('MAIL_FROM_ADDRESS')}>`

  subject = 'Your Subscription is Confirmed!'

  prepare() {
    const frontendUrl = env.get('FRONTEND_URL')

    const textContent = `
Hi ${this.user.fullName},

Thank you for your payment! Your account subscription is now active for the ${this.user.tier} plan. Enjoy!


You can now access all your new features. To manage your subscription or view invoices, please visit your account dashboard:
${frontendUrl}/dashboard

Thanks,
The Sojourner Team
`

    // 2. HTML version with inline styles for maximum compatibility
    const htmlContent = `
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif; background-color: #f4f4f7;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f4f4f7; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" border="0" cellspacing="0" cellpadding="0" style="width: 600px; background-color: #ffffff; border-radius: 8px; margin: 0 auto;">
          <tr>
            <td style="padding: 40px;">
              <h1 style="font-size: 24px; font-weight: 600; color: #333; margin-top: 0;">Your Subscription is Confirmed!</h1>
              <p style="font-size: 16px; line-height: 24px; color: #333;">
                Hi ${this.user.fullName},
              </p>
              <p style="font-size: 16px; line-height: 24px; color: #333;">
                Thanks for your payment! Your account subscription is now active. This email confirms your recent purchase.
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
              </p>
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
