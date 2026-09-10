/**
 * Shared TS interfaces (plan §5.6). The service<->controller result-object
 * contract and the wire envelope shape.
 */

export interface IServiceResult<T = any> {
  status: boolean;
  status_code: number;
  status_message: string;
  data_sets?: T;
}

export interface IResponseStatus {
  msg: string;
  action_status: boolean;
}

export interface IResponsePublish {
  version: string;
  developer: string;
}

export interface IResponseEnvelope<T = any> {
  response: {
    dataset?: T;
    data?: unknown;
    status: IResponseStatus;
    publish: IResponsePublish;
  };
}

export interface ITokenVerifyResult {
  error: boolean;
  message: string;
  verifiedData: any;
}
