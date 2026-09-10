import { Request, Response } from 'express';
import { AuthService } from '../service/auth_service';
import {
  ILoginRequest,
  IGenerateTokenRequest,
  IRegenerateTokenRequest,
  IForgetPassReq,
  IVerifyOtpReq,
  IResetPasswordReq,
} from '../interface/auth_interface';

/**
 * `AuthController` (plan §5.3 / §14.1). Thin: map `request.body` -> DTO, call the
 * service, map the result object -> HTTP envelope. No business logic.
 */
export class AuthController {
  private readonly _service = new AuthService();

  private initLog(): void {
    /* parity with plan convention */
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: loginController
   */
  public loginController = async (request: Request, response: Response): Promise<void> => {
    this.initLog();
    const trace = `loginController${global.Helpers.getTraceID(request.body)}`;
    try {
      const param: ILoginRequest = {
        email: request.body.email,
        password: request.body.password,
        login_type: Number(request.body.login_type || 1),
        browser: request.body.browser || {},
      };
      const ret = await this._service.loginService(param);
      if (ret.status) {
        global.Helpers.successStatusBuild(response, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(response, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(response, 'Something went wrong. Please try again');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: generateToken
   */
  public generateToken = async (request: Request, response: Response): Promise<void> => {
    this.initLog();
    const trace = `generateToken${global.Helpers.getTraceID(request.body)}`;
    try {
      const param: IGenerateTokenRequest = { authorization_code: request.body.authorization_code };
      const ret = await this._service.generateTokenService(param);
      if (ret.status) {
        global.Helpers.successStatusBuild(response, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(response, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(response, 'Something went wrong. Please try again');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: reGenerateToken
   */
  public reGenerateToken = async (request: Request, response: Response): Promise<void> => {
    this.initLog();
    const trace = `reGenerateToken${global.Helpers.getTraceID(request.body)}`;
    try {
      const param: IRegenerateTokenRequest = {
        access_token: request.body.access_token,
        refresh_token: request.body.refresh_token,
      };
      const ret = await this._service.reGenerateTokenService(param);
      if (ret.status) {
        global.Helpers.successStatusBuild(response, ret.data_sets, ret.status_message);
        return;
      }
      if (ret.status_code === 401) {
        global.Helpers.unauthorizedStatusBuild(response, ret.status_message);
        return;
      }
      global.Helpers.badRequestStatusBuild(response, ret.status_message);
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(response, 'Something went wrong. Please try again');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: forgetPassword
   */
  public forgetPassword = async (request: Request, response: Response): Promise<void> => {
    this.initLog();
    const trace = `forgetPassword${global.Helpers.getTraceID(request.body)}`;
    try {
      const param: IForgetPassReq = { email: request.body.email };
      const ret = await this._service.forgetPasswordService(param);
      if (ret.status) {
        global.Helpers.successStatusBuild(response, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(response, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(response, 'Something went wrong. Please try again');
    }
  };

  /*
   * @Developer: Sougata
   * @Date: 2026-08-31
   * @Function: verifyOtp
   */
  public verifyOtp = async (request: Request, response: Response): Promise<void> => {
    this.initLog();
    const trace = `verifyOtp${global.Helpers.getTraceID(request.body)}`;
    try {
      const param: IVerifyOtpReq = { email: request.body.email, otp: request.body.otp };
      const ret = await this._service.otpVerifyService(param);
      if (ret.status) {
        global.Helpers.successStatusBuild(response, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(response, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(response, 'Something went wrong. Please try again');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: resetPassword
   */
  public resetPassword = async (request: Request, response: Response): Promise<void> => {
    this.initLog();
    const trace = `resetPassword${global.Helpers.getTraceID(request.body)}`;
    try {
      const param: IResetPasswordReq = {
        email: request.body.email,
        password: request.body.password,
        confirm_password: request.body.confirm_password,
      };
      const ret = await this._service.resetPassWordService(param);
      if (ret.status) {
        global.Helpers.successStatusBuild(response, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(response, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(response, 'Something went wrong. Please try again');
    }
  };
}
