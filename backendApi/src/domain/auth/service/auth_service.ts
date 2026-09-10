import { v4 as uuidv4 } from 'uuid';
import { jWT_helper } from '../../../helper/jwt_helper';
import { IServiceResult } from '../../../helper/common_interface';
import { usersModel } from '../models/model.users';
import { clientsModel } from '../models/model.clients';
import { loginTokensModel } from '../models/model.login_tokens';
import { userLoginsModel } from '../models/model.user_login';
import { socialLoginsModel } from '../models/model.social_logins';
import { userOtpModel } from '../models/model.user_otp';
import { invalidEmailsModel } from '../models/model.invalid_emails';
import {
  ILoginRequest,
  IGenerateAuthCodeParam,
  IGenerateTokenRequest,
  IRegenerateTokenRequest,
  IForgetPassReq,
  IVerifyOtpReq,
  IResetPasswordReq,
} from '../interface/auth_interface';

/**
 * `AuthService` (plan §7.1 / §14.1). Business logic for the 2-step OAuth-style
 * login, token refresh and the email-OTP password-reset chain. Every method
 * returns a result object; nothing throws across the layer boundary.
 */
export class AuthService {
  private readonly _jwt = new jWT_helper();
  private readonly _usersModel = new usersModel();
  private readonly _clientsModel = new clientsModel();
  private readonly _loginTokensModel = new loginTokensModel();
  private readonly _userLoginsModel = new userLoginsModel();
  private readonly _socialLoginsModel = new socialLoginsModel();
  private readonly _userOtpModel = new userOtpModel();
  private readonly _invalidEmailsModel = new invalidEmailsModel();

  private readonly logName = 'auth_service';

  private initLog(): void {
    /* parity with plan convention (sets file_name/application on a shared log obj) */
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  // -------------------------------------------------------------- step 1: login
  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: loginService
   */
  public async loginService(reqData: ILoginRequest): Promise<IServiceResult> {
    this.initLog();
    this.log('loginService', ['Request : ', { email: reqData.email, login_type: reqData.login_type }]);
    try {
      const loginType = Number(reqData.login_type || 1);
      if (loginType === 2) {
        return global.Helpers.makeBadServiceStatus('Social login is not supported yet.');
      }

      const user: any = await this._usersModel.findByAny({ email: reqData.email });
      if (!user) {
        return global.Helpers.makeBadServiceStatus('Invalid email or password.');
      }
      if (Number(user.user_status) === 0) {
        return global.Helpers.makeBadServiceStatus('Your account is inactive. Please contact the administrator.');
      }

      const passwordOk = await global.Helpers.comparePassword(reqData.password, user.password_hash);
      if (!passwordOk) {
        return global.Helpers.makeBadServiceStatus('Invalid email or password.');
      }

      const authCode = await this.generateAuthCode({
        user_id: user.user_id || String(user._id),
        email: user.email,
        browser: reqData.browser,
      });
      if (!authCode.status) {
        return authCode;
      }

      return global.Helpers.makeSuccessServiceStatus('Authorization code generated successfully.', authCode.data_sets);
    } catch (err: any) {
      this.log('loginService', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  // --------------------------------------------------- auth-code issuance (§7.1)
  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: generateAuthCode
   */
  public async generateAuthCode(param: IGenerateAuthCodeParam): Promise<IServiceResult> {
    try {
      let client: any = await this._clientsModel.findByAny({ client_name: 'Web' });
      if (!client) {
        client = await this._clientsModel.addNewRecord({
          client_id: uuidv4(),
          client_name: 'Web',
          client_secret: uuidv4(),
          redirect_url: process.env.WEB_REDIRECT_URL || 'http://localhost:4200/auth/callback',
          status: 1,
        });
      }
      const clientId = client.client_id || String(client._id);
      const browserId = param.browser?.id || 'default';
      const browserName = param.browser?.name || 'unknown';

      // upsert-by-hand: user_logins row for this user + browser
      const loginFilter = { user_id: param.user_id, 'browser.id': browserId, 'browser.name': browserName };
      const loginExists = await this._userLoginsModel.countAllByAny(loginFilter);
      if (loginExists > 0) {
        await this._userLoginsModel.updateAnyRecord(loginFilter, {
          session_id: uuidv4(),
          'browser.version': param.browser?.version || '',
          is_logged_in: 1,
          updated_at: new Date(),
        });
      } else {
        await this._userLoginsModel.addNewRecord({
          user_id: param.user_id,
          session_id: uuidv4(),
          browser: { id: browserId, name: browserName, version: param.browser?.version || '' },
          is_logged_in: 1,
        });
      }

      const authCode = global.Helpers.encryptObject(
        JSON.stringify({ user_id: param.user_id, client_id: clientId, client_name: 'Web', browser_id: browserId }),
      );

      // upsert-by-hand: login_tokens row for this user + client
      const tokenFilter = { user_id: param.user_id, client_id: clientId };
      const tokenExists = await this._loginTokensModel.countAllByAny(tokenFilter);
      if (tokenExists > 0) {
        await this._loginTokensModel.updateAnyRecord(tokenFilter, {
          auth_code: authCode,
          access_token: null,
          refresh_token: null,
          access_token_expire: null,
          refresh_token_expire: null,
          updated_at: new Date(),
        });
      } else {
        await this._loginTokensModel.addNewRecord({ ...tokenFilter, auth_code: authCode });
      }

      return global.Helpers.makeSuccessServiceStatus('ok', {
        authorization_code: authCode,
        redirect_url: client.redirect_url || '',
      });
    } catch (err: any) {
      this.log('generateAuthCode', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  // -------------------------------------------- step 2: auth-code -> JWT (§7.1)
  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: generateTokenService
   */
  public async generateTokenService(reqData: IGenerateTokenRequest): Promise<IServiceResult> {
    this.initLog();
    this.log('generateTokenService', ['Request : ', { authorization_code: '***' }]);
    try {
      const row: any = await this._loginTokensModel.findByAny({ auth_code: reqData.authorization_code });
      if (!row) {
        return global.Helpers.makeBadServiceStatus('Invalid or expired authorization code.');
      }

      let decoded: any;
      try {
        decoded = global.Helpers.decryptObj(reqData.authorization_code);
      } catch {
        return global.Helpers.makeBadServiceStatus('Invalid authorization code.');
      }
      if (!decoded || !decoded.user_id || !decoded.client_id || decoded.client_name !== 'Web') {
        return global.Helpers.makeBadServiceStatus('Invalid authorization code.');
      }

      let user: any = await this._usersModel.findByAny({ user_id: decoded.user_id });
      if (!user) {
        try {
          user = await this._usersModel.findByAny({ _id: decoded.user_id });
        } catch {
          user = null;
        }
      }
      if (!user) {
        return global.Helpers.makeBadServiceStatus('User not found.');
      }
      if (Number(user.user_status) === 0) {
        return global.Helpers.makeBadServiceStatus('Your account is inactive. Please contact the administrator.');
      }

      const tokens = this._jwt.createToken({
        user_id: user.user_id || String(user._id),
        user_email: user.email,
        client_id: decoded.client_id,
      });

      const accessExpire = global.Helpers.TokenExpiryDate(process.env.JWT_EXPIRES || '1h');
      const refreshExpire = global.Helpers.TokenExpiryDate(process.env.REFRESH_TOKEN_EXPIRE || '7d');

      await this._loginTokensModel.updateAnyRecord(
        { _id: row._id },
        {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          access_token_expire: accessExpire,
          refresh_token_expire: refreshExpire,
          auth_code: null, // single-use
          updated_at: new Date(),
        },
      );

      return global.Helpers.makeSuccessServiceStatus('Token generated successfully.', {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        refresh_token_expire_timestamp: global.Helpers.getTimestampUTC(refreshExpire),
      });
    } catch (err: any) {
      this.log('generateTokenService', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  // ---------------------------------------------------------- refresh (§7.1)
  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: reGenerateTokenService
   */
  public async reGenerateTokenService(reqData: IRegenerateTokenRequest): Promise<IServiceResult> {
    this.initLog();
    this.log('reGenerateTokenService', ['Request : ', { refresh_token: '***', access_token: '***' }]);
    try {
      const row: any = await this._loginTokensModel.findByAny({ refresh_token: reqData.refresh_token });
      if (!row) {
        return global.Helpers.makeUnAuthorizedServiceStatus('Invalid refresh token.');
      }

      const nowTs = global.Helpers.getTimestampUTC(new Date());
      if (row.refresh_token_expire && global.Helpers.getTimestampUTC(row.refresh_token_expire) < nowTs) {
        return global.Helpers.makeUnAuthorizedServiceStatus('Refresh token expired.');
      }

      const regen = this._jwt.regenerateToken({
        param: { refreshTokenOld: reqData.refresh_token, accessTokenOld: reqData.access_token },
      });
      if (regen.error || !regen.data) {
        return global.Helpers.makeUnAuthorizedServiceStatus(regen.message || 'Invalid refresh token.');
      }

      const accessExpire = global.Helpers.TokenExpiryDate(process.env.JWT_EXPIRES || '1h');
      const refreshExpire = global.Helpers.TokenExpiryDate(process.env.REFRESH_TOKEN_EXPIRE || '7d');

      await this._loginTokensModel.updateAnyRecord(
        { _id: row._id },
        {
          access_token: regen.data.access_token,
          refresh_token: regen.data.refresh_token,
          access_token_expire: accessExpire,
          refresh_token_expire: refreshExpire,
          updated_at: new Date(),
        },
      );

      return global.Helpers.makeSuccessServiceStatus('Token regenerated successfully.', {
        access_token: regen.data.access_token,
        refresh_token: regen.data.refresh_token,
        refresh_token_expire_timestamp: global.Helpers.getTimestampUTC(refreshExpire),
      });
    } catch (err: any) {
      this.log('reGenerateTokenService', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  // ------------------------------------------------ password reset chain (§7.1)
  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: forgetPasswordService
   */
  public async forgetPasswordService(reqData: IForgetPassReq): Promise<IServiceResult> {
    this.initLog();
    this.log('forgetPasswordService', ['Request : ', { email: reqData.email }]);
    try {
      const user: any = await this._usersModel.findByAny({ email: reqData.email });
      if (!user) {
        return global.Helpers.makeBadServiceStatus('No account found with this email address.');
      }

      const isSocial = await this._socialLoginsModel.countAllByAny({ email: reqData.email });
      if (isSocial > 0) {
        return global.Helpers.makeBadServiceStatus('This account uses social login; password reset is not available.');
      }

      const bounced = await this._invalidEmailsModel.countAllByOR(reqData.email);
      if (bounced > 0) {
        return global.Helpers.makeBadServiceStatus('We are unable to send email to this address.');
      }

      const since = global.Helpers.checkOtpTime();
      const recentAttempts = await this._userOtpModel.countAllByAny({
        email: reqData.email,
        created_at: { $gte: since },
      });
      const maxAttempts = parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10);
      if (recentAttempts >= (Number.isNaN(maxAttempts) ? 5 : maxAttempts)) {
        return global.Helpers.makeBadServiceStatus('Too many OTP requests. Please try again later.');
      }

      await this._userOtpModel.updateAnyRecord({ email: reqData.email }, { status: 0 });

      const otp = global.Helpers.randomNumber(6);
      await this._userOtpModel.addNewRecord({ email: reqData.email, otp, status: 1, created_at: new Date() });

      await global.Helpers.sendEmailThroughSmtp(
        'forget_password',
        {
          name: user.first_name || 'User',
          otp,
          expiry_minutes: process.env.OTP_EXPIRY_TIME || '10',
        },
        reqData.email,
        'Password reset code',
      );

      const dataset: Record<string, unknown> = { message: 'An OTP has been sent to your registered email.' };
      if (process.env.NODE_ENV !== 'production') {
        // dev convenience so the flow is testable without a live mailbox
        dataset.otp = otp;
      }

      return global.Helpers.makeSuccessServiceStatus('An OTP has been sent to your registered email.', dataset);
    } catch (err: any) {
      this.log('forgetPasswordService', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: otpVerifyService
   */
  public async otpVerifyService(reqData: IVerifyOtpReq): Promise<IServiceResult> {
    this.initLog();
    this.log('otpVerifyService', ['Request : ', { email: reqData.email }]);
    try {
      const row: any = await this._userOtpModel.findByAny({ email: reqData.email, otp: reqData.otp, status: 1 });
      if (!row) {
        return global.Helpers.makeBadServiceStatus('Invalid OTP.');
      }

      const stillValid = global.Helpers.checkTimeDifference(row.created_at, process.env.OTP_EXPIRY_TIME || '10');
      if (!stillValid) {
        await this._userOtpModel.updateAnyRecord({ email: reqData.email }, { status: 0 });
        return global.Helpers.makeBadServiceStatus('OTP has expired. Please request a new one.');
      }

      await this._userOtpModel.deleteMany({ email: reqData.email });
      return global.Helpers.makeSuccessServiceStatus('OTP verified successfully.', { verified: true });
    } catch (err: any) {
      this.log('otpVerifyService', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: resetPassWordService
   */
  public async resetPassWordService(reqData: IResetPasswordReq): Promise<IServiceResult> {
    this.initLog();
    this.log('resetPassWordService', ['Request : ', { email: reqData.email }]);
    try {
      if (reqData.password !== reqData.confirm_password) {
        return global.Helpers.makeBadServiceStatus('Password and confirm password do not match.');
      }

      const user: any = await this._usersModel.findByAny({ email: reqData.email });
      if (!user) {
        return global.Helpers.makeBadServiceStatus('No account found with this email address.');
      }

      const sameAsOld = await global.Helpers.comparePassword(reqData.password, user.password_hash);
      if (sameAsOld) {
        return global.Helpers.makeBadServiceStatus('New password must be different from the current password.');
      }

      const passwordHash = await global.Helpers.hashPassword(reqData.password);
      await this._usersModel.updateAnyRecord({ _id: user._id }, { password_hash: passwordHash, updated_at: new Date() });

      return global.Helpers.makeSuccessServiceStatus('Password has been reset successfully.', { reset: true });
    } catch (err: any) {
      this.log('resetPassWordService', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }
}
