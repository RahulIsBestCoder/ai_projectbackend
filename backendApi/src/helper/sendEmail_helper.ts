import nodemailer from 'nodemailer';

/**
 * `sendEmail_helper` (plan §11). SES path is stubbed to fall through to SMTP in
 * this build. Actual delivery is gated by `SEND_EMAIL=1` so the auth flows work
 * without a live mail server during development.
 */
export class sendEmail_helper {
  public async smtpSendSMTPEmail(to: string, subject: string, html: string): Promise<any> {
    if (String(process.env.SEND_EMAIL) !== '1') {
      global.logs?.writelog(
        'sendEmail_helper.smtpSendSMTPEmail',
        ['email delivery disabled (SEND_EMAIL != 1); would send ->', to, '|', subject],
        'INFO',
      );
      return { skipped: true, to, subject };
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: 465,
      secure: true,
      auth: { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD },
    });

    return transporter.sendMail({
      from: process.env.SENDER_EMAIL || process.env.NO_REPLY,
      to,
      subject,
      html,
    });
  }

  public async smtpSendSESEmail(to: string, subject: string, html: string): Promise<any> {
    // SES client not bundled in this build; delegate to SMTP / disabled path.
    return this.smtpSendSMTPEmail(to, subject, html);
  }
}
