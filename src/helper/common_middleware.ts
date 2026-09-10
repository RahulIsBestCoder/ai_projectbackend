import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import multiparty from 'multiparty';
import { jWT_helper } from './jwt_helper';

/**
 * `common_middleware` (plan §5.2). Shared request-pipeline middleware.
 * All members are arrow-function properties so they can be passed by reference
 * into route middleware arrays without losing `this`.
 */
export class common_middleware {
  private readonly _jwt = new jWT_helper();

  /** Global. Whole-body AES decryption when `ENCRYPTED_DATA=1` and `enc_data` present. */
  public decryptFromdata = (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const contentType = String(req.headers['content-type'] || '');
      if (
        req.body &&
        req.body.enc_data &&
        contentType.includes('application/json') &&
        process.env.ENCRYPTED_DATA === '1'
      ) {
        req.body = JSON.parse(global.encrypt_decrypt_helper.decryptRequest(req.body.enc_data));
      }
    } catch (err) {
      global.logs.writelog('common_middleware.decryptFromdata', err, 'ERROR');
    }
    next();
  };

  /** Lets multipart endpoints share the JSON body pipeline. */
  public validateFormData = (req: Request, _res: Response, next: NextFunction): void => {
    if (req.body && Object.keys(req.body).length > 0) {
      next();
      return;
    }
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.includes('multipart/form-data')) {
      next();
      return;
    }

    const form = new multiparty.Form();
    form.parse(req, (err: unknown, fields: Record<string, unknown[]>, files: Record<string, unknown[]>) => {
      if (err) {
        global.logs.writelog('common_middleware.validateFormData', err, 'ERROR');
        next();
        return;
      }
      req.body = req.body || {};
      Object.keys(fields || {}).forEach((k) => {
        req.body[k] = Array.isArray(fields[k]) ? fields[k][0] : fields[k];
      });
      Object.keys(files || {}).forEach((k) => {
        req.body[k] = files[k];
      });
      next();
    });
  };

  /** express-validator result -> 400 (or 401 for the app-update sentinel) envelope. */
  public checkforerrors = (req: Request, res: Response, next: NextFunction): void => {
    const result = validationResult(req);
    if (result.isEmpty()) {
      next();
      return;
    }
    const errors = result.array();
    const firstMsg = (errors[0] as any)?.msg;
    const msg = typeof firstMsg === 'string' ? firstMsg : 'Validation failed';
    global.Helpers.validationErrorBuild(res, errors, msg);
  };

  /** Bearer token -> `req.body.loginDetails` (plan §7.2). */
  public validateToken = (req: Request, res: Response, next: NextFunction): void => {
    const header = String(req.headers['authorization'] || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim();
    if (!token) {
      global.Helpers.unauthorizedStatusBuild(res, 'Authorization token missing');
      return;
    }
    const verified = this._jwt.verifyToken(token);
    if (verified.error) {
      global.Helpers.unauthorizedStatusBuild(res, verified.message || 'Unauthorized');
      return;
    }
    req.body = req.body || {};
    req.body.loginDetails = { error: false, message: verified.message, verifiedData: verified.verifiedData };
    next();
  };

  /**
   * ACL enforcement (plan §7.3). Present for parity but intentionally latent —
   * not wired into any route in the current code base.
   */
  public checkAccessPermission = (_req: Request, _res: Response, next: NextFunction): void => {
    next();
  };
}
