/**
 * auth DTOs (plan §5.6 / §14.1).
 */

export interface IBrowserInfo {
  id?: string;
  name?: string;
  version?: string;
}

export interface ILoginRequest {
  email: string;
  password: string;
  login_type: number; // 1 = normal, 2 = social (stubbed)
  browser?: IBrowserInfo;
}

export interface IGenerateAuthCodeParam {
  user_id: string;
  email: string;
  browser?: IBrowserInfo;
}

export interface IGenerateTokenRequest {
  authorization_code: string;
}

export interface IRegenerateTokenRequest {
  access_token: string;
  refresh_token: string;
}

export interface IForgetPassReq {
  email: string;
}

export interface IVerifyOtpReq {
  email: string;
  otp: string;
}

export interface IResetPasswordReq {
  email: string;
  password: string;
  confirm_password: string;
}
