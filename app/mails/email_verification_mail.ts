import { BaseMail } from '@adonisjs/mail'
import User from '#models/user'
import env from '#start/env'

export default class EmailVerificationMail extends BaseMail {
  subject = 'Verify Your Email'

  constructor(
    private user: User,
    private emailVerificationUrl: string
  ) {
    super()
  }

  prepare() {
    const appName = env.get('APP_NAME')

    this.message.to(this.user.email)
    this.message.from(env.get('MAIL_FROM_ADDRESS'), env.get('MAIL_FROM_NAME'))
    this.message.subject(this.subject)

    this.message.html(`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Verify Your Email</h2>
        <p>Hi ${this.user.fullName},</p>
        <p> Click the button below to verify your email</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${this.emailVerificationUrl}" 
             style="background-color: #5850ec; color: white; padding: 12px 24px; 
                    text-decoration: none; border-radius: 5px; display: inline-block;">
            Verify Email
          </a>
        </div>
        <p>Or copy and paste this link in your browser:</p>
        <p style="word-break: break-all; color: #666;">${this.emailVerificationUrl}</p>
        <p style="color: #666; font-size: 14px;">
          This link will expire in 1 hour. If you didn't request this, 
          please ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">
          © ${new Date().getFullYear()} ${appName}. All rights reserved.
        </p>
      </div>
    `)

    this.message.text(`
      Verify your Email
      
      Hi ${this.user.fullName},
      
      Visit the link below to verify your email:
      
      ${this.emailVerificationUrl}
      
      This link will expire in 1 hour. If you didn't request this, please ignore this email.
      
      © ${new Date().getFullYear()} ${appName}. All rights reserved.
    `)
  }
}
