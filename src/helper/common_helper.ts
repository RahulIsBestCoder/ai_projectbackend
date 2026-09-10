import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import ejs from 'ejs';
import moment from 'moment-timezone';
import { Response } from 'express';
import { helperConfig } from './helper_config';
import { sendEmail_helper } from './sendEmail_helper';
import { IServiceResult } from './common_interface';

/**
 * `common_helper` – global helper utilities.
 * Provides response envelope builders, service‑result helpers, crypto, bcrypt,
 * email dispatch, and miscellaneous helpers.
 */
export class common_helper {
  private readonly _email = new sendEmail_helper();

  // ------------------------------------------------------------------ envelope
  private publish() {
    return {
      version: process.env.VERSION || '1.0.0',
      developer: process.env.API_DEVELOPER || '',
    };
  }

  private buildBody(
    payloadKey: 'dataset' | 'data',
    payload: unknown,
    msg: string,
    action_status: boolean
  ) {
    let body = payload;
    if (
      payloadKey === 'dataset' &&
      action_status &&
      process.env.ENCRYPTED_DATA === '1' &&
      payload !== undefined
    ) {
      body = {
        enc_data: global.encrypt_decrypt_helper.encryptResponse(
          JSON.stringify(payload)
        ),
      };
    }
    return {
      response: {
        [payloadKey]: body ?? {},
        status: { msg: this.capitalizeFirstLetter(msg || ''), action_status },
        publish: this.publish(),
      },
    };
  }

  public successStatusBuild(res: Response, dataset: unknown, msg: string) {
    return res
      .status(helperConfig.HTTP_STATUS_OK)
      .send(this.buildBody('dataset', dataset, msg, true));
  }

  public badRequestStatusBuild(res: Response, msg: string) {
    return res
      .status(helperConfig.HTTP_STATUS_BAD_REQUEST)
      .send(this.buildBody('dataset', {}, msg, false));
  }

  public unauthorizedStatusBuild(res: Response, msg: string) {
    return res
      .status(helperConfig.HTTP_STATUS_UNAUTHORIZED)
      .send(this.buildBody('dataset', {}, msg, false));
  }

  public forbiddenRequestStatusBuild(res: Response, msg: string) {
    return res
      .status(helperConfig.HTTP_STATUS_FORBIDDEN)
      .send(this.buildBody('dataset', {}, msg, false));
  }

  public methodNotAllowedStatusBuild(res: Response, msg: string) {
    return res
      .status(helperConfig.HTTP_STATUS_METHOD_NOT_ALLOWED)
      .send(this.buildBody('dataset', {}, msg, false));
  }

  public notAcceptableStatusBuild(res: Response, msg: string) {
    return res
      .status(helperConfig.HTTP_STATUS_NOT_ACCEPTABLE)
      .send(this.buildBody('dataset', {}, msg, false));
  }

  public validationErrorBuild(
    res: Response,
    errors: unknown[],
    msg = 'Validation failed'
  ) {
    const code =
      msg === 'Please update your app.'
        ? helperConfig.HTTP_STATUS_UNAUTHORIZED
        : helperConfig.HTTP_STATUS_BAD_REQUEST;
    return res
      .status(code)
      .send(this.buildBody('data', errors, msg, false));
  }

  // ------------------------------------------------------------ service result
  public makeSuccessServiceStatus(msg: string, data: any = {}): IServiceResult {
    return {
      status: true,
      status_code: 200,
      status_message: msg,
      data_sets: data,
    };
  }

  public makeBadServiceStatus(msg: string): IServiceResult {
    return {
      status: false,
      status_code: 400,
      status_message: msg,
    };
  }

  public makeUnAuthorizedServiceStatus(msg: string): IServiceResult {
    return {
      status: false,
      status_code: 401,
      status_message: msg,
    };
  }

  // -------------------------------------------------------------------- crypto
  private aesParams() {
    return {
      algo: process.env.ALGORITHM || 'aes-256-cbc',
      key: crypto
        .createHash('sha256')
        .update(String(process.env.SECRET_KEY || 'secret'))
        .digest(),
      iv: Buffer.from(
        String(process.env.IV || '1234567890123456').padEnd(16, '0').slice(0, 16)
      ),
    };
  }

  /** AES‑encrypt an already‑serialised string; returns hex. */
  public encryptObject(text: string): string {
    const { algo, key, iv } = this.aesParams();
    const cipher = crypto.createCipheriv(algo, key, iv);
    return Buffer.concat([
      cipher.update(Buffer.from(text, 'utf8')),
      cipher.final(),
    ]).toString('hex');
  }

  /** AES‑decrypt a hex string; JSON‑parses when possible. */
  public decryptObj(hex: string): any {
    const { algo, key, iv } = this.aesParams();
    const decipher = crypto.createDecipheriv(algo, key, iv);
    const out = Buffer.concat([
      decipher.update(Buffer.from(hex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
    try {
      return JSON.parse(out);
    } catch {
      return out;
    }
  }

  public encryptId(value: string | number): string {
    return this.encryptObject(String(value));
  }

  public decryptId(hex: string): string {
    const v = this.decryptObj(hex);
    return typeof v === 'string' ? v : JSON.stringify(v);
  }

  // -------------------------------------------------------------------- bcrypt
  public async hashPassword(plain: string): Promise<string> {
    const rounds = parseInt(process.env.SALT || '10', 10);
    const salt = await bcrypt.genSalt(Number.isNaN(rounds) ? 10 : rounds);
    return bcrypt.hash(plain, salt);
  }

  public async comparePassword(plain: string, hash: string): Promise<boolean> {
    if (!hash) return false;
    return bcrypt.compare(plain, hash);
  }

  // --------------------------------------------------------------------- email
  public async sendEmailThroughSmtp(
    template: string,
    data: Record<string, unknown>,
    to: string,
    subject: string
  ) {
    try {
      const file = path.join(global.path, 'views', 'email_templates', `${template}.ejs`);
      const html = (await ejs.renderFile(file, data)) as string;
      if ((process.env.EMAIL_TYPE || 'SMTP').toUpperCase() === 'SES') {
        return this._email.smtpSendSESEmail(to, subject, html);
      }
      return this._email.smtpSendSMTPEmail(to, subject, html);
    } catch (err) {
      global.logs.writelog('common_helper.sendEmailThroughSmtp', err, 'ERROR');
      return { error: true };
    }
  }

  // ---------------------------------------------------------------------- misc
  public capitalizeFirstLetter(str: string): string {
    if (!str) return '';
    const s = String(str).toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  public getTraceID(body: any): string {
    const id = body?.loginDetails?.id || body?.trace_id || '';
    return id ? ` [${id}]` : '';
  }

  public randomNumber(digits: number): string {
    let out = '';
    for (let i = 0; i < digits; i += 1) {
      out += Math.floor(Math.random() * 10).toString();
    }
    return out;
  }

  public getTimestampUTC(date: Date | string | number = new Date()): number {
    return moment.utc(date).valueOf();
  }

  /** Absolute expiry timestamp string for a relative spec like `1h` / `7d`. */
  public TokenExpiryDate(spec: string): string {
    const match = String(spec).match(/^(\d+)\s*([smhd])$/i);
    let ms = 3600 * 1000;
    if (match) {
      const n = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();
      const factor =
        unit === 's'
          ? 1000
          : unit === 'm'
          ? 60000
          : unit === 'h'
          ? 3600000
          : 86400000;
      ms = n * factor;
    }
    return moment.utc(Date.now() + ms).format('YYYY-MM-DD HH:mm:ss');
  }

  /** Lower bound for counting recent OTP requests (throttle window). */
  public checkOtpTime(): Date {
    const mins = parseInt(process.env.OTP_LIMIT_TIME || '60', 10);
    return new Date(Date.now() - (Number.isNaN(mins) ? 60 : mins) * 60 * 1000);
  }

  /** true => the record at `createdAt` is still inside the `expiryMinutes` window. */
  public checkTimeDifference(createdAt: Date | string, expiryMinutes: string | number): boolean {
    const limit = parseInt(String(expiryMinutes || '10'), 10);
    const diffMin = (Date.now() - new Date(createdAt).getTime()) / 60000;
    return diffMin <= (Number.isNaN(limit) ? 10 : limit);
  }

  public currentUTC(): string {
    return moment.utc().format('YYYY-MM-DD HH:mm:ss');
  }

  public getCurrentISTDate(): string {
    const utc = Date.now() / 1000;
    return moment.unix(utc).tz(process.env.TZ as string).format('YYYY-MM-DD');
  }

  public getCurrentISTDateTime(): string {
    const date = new Date();
    const mons = date.toLocaleString('default', { month: 'short' });
    const str_date =
      mons +
      ' ' +
      date.getDate() +
      ' ' +
      ('0' + date.getHours()).slice(-2) +
      ':' +
      ('0' + date.getMinutes()).slice(-2) +
      ':' +
      ('0' + date.getSeconds()).slice(-2);
    return str_date;
  }
}
