import { Global, Injectable, Logger, Module } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { config } from './config';

/** Transactional email (password reset, invitations, sign-in codes) over SMTP (SES, Postmark, etc.). */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transport: Transporter | null = config.mail.host
    ? nodemailer.createTransport({
        host: config.mail.host, port: config.mail.port, secure: config.mail.port === 465,
        auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
      })
    : null;

  constructor() {
    if (!this.transport && config.isProd) this.logger.error('SMTP_HOST is not set: password reset, invite and sign-in code emails cannot be delivered.');
  }

  async send(to: string, subject: string, text: string) {
    if (!this.transport) {
      // Development only: never print message bodies (they contain links/codes) in production logs.
      if (!config.isProd) this.logger.log(`[dev mail] to=${to} subject="${subject}"\n${text}`);
      return;
    }
    await this.transport.sendMail({ from: config.mail.from, to, subject, text });
  }
}

@Global()
@Module({ providers: [MailerService], exports: [MailerService] })
export class MailerModule {}
