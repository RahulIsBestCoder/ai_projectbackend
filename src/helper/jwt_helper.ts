import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { ITokenVerifyResult } from './common_interface';

/**
 * `jWT_helper` (plan §7.1 / §7.2). Double-wrapped tokens: `jwt.sign(...)` then
 * AES (`aes-256-cbc`, key = SHA-256(JWT_SECRET), iv = ENCRYPTION_IV_KEY), base64.
 */
const AES_ALGO = 'aes-256-cbc';

function aesKey(): Buffer {
  return crypto.createHash('sha256').update(String(process.env.JWT_SECRET || 'secret')).digest();
}
function aesIv(): Buffer {
  return Buffer.from(String(process.env.ENCRYPTION_IV_KEY || '1234567890123456').padEnd(16, '0').slice(0, 16));
}
function encryptMe(text: string): string {
  const cipher = crypto.createCipheriv(AES_ALGO, aesKey(), aesIv());
  return Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]).toString('base64');
}
function decryptMe(text: string): string {
  const decipher = crypto.createDecipheriv(AES_ALGO, aesKey(), aesIv());
  return Buffer.concat([decipher.update(Buffer.from(text, 'base64')), decipher.final()]).toString('utf8');
}

export interface IJwtPayload {
  user_id: string;
  user_email: string;
  client_id: string;
  [k: string]: unknown;
}

export class jWT_helper {
  private algorithm(): jwt.Algorithm {
    return (process.env.JWT_ALGORITHM || 'HS256') as jwt.Algorithm;
  }

  public createToken(payload: IJwtPayload): { access_token: string; refresh_token: string } {
    const access = jwt.sign({ ...payload }, String(process.env.JWT_SECRET), {
      algorithm: this.algorithm(),
      expiresIn: process.env.JWT_EXPIRES || '1h',
    } as jwt.SignOptions);

    const refresh = jwt.sign({ ...payload }, String(process.env.REFRESH_TOKEN_KEY), {
      algorithm: this.algorithm(),
      expiresIn: process.env.REFRESH_TOKEN_EXPIRE || '7d',
    } as jwt.SignOptions);

    return { access_token: encryptMe(access), refresh_token: encryptMe(refresh) };
  }

  public verifyToken(token: string): ITokenVerifyResult {
    try {
      const raw = decryptMe(token);
      const decoded = jwt.verify(raw, String(process.env.JWT_SECRET), { algorithms: [this.algorithm()] });
      return { error: false, message: 'Token verified', verifiedData: decoded };
    } catch (err: any) {
      return { error: true, message: err?.message || 'Invalid token', verifiedData: null };
    }
  }

  public regenerateToken(input: { param: { refreshTokenOld: string; accessTokenOld: string } }): {
    error: boolean;
    message: string;
    data: { access_token: string; refresh_token: string } | null;
  } {
    try {
      const refreshRaw = decryptMe(input.param.refreshTokenOld);
      const refreshDecoded: any = jwt.verify(refreshRaw, String(process.env.REFRESH_TOKEN_KEY), {
        algorithms: [this.algorithm()],
      });

      // The access token is allowed to be expired; verify signature, tolerate expiry.
      let accessDecoded: any = {};
      try {
        const accessRaw = decryptMe(input.param.accessTokenOld);
        try {
          accessDecoded = jwt.verify(accessRaw, String(process.env.JWT_SECRET), { algorithms: [this.algorithm()] });
        } catch (e: any) {
          if (e?.name === 'TokenExpiredError') {
            accessDecoded = jwt.decode(accessRaw) || {};
          } else {
            throw e;
          }
        }
      } catch {
        accessDecoded = {};
      }

      const payload: IJwtPayload = {
        user_id: refreshDecoded.user_id ?? accessDecoded.user_id,
        user_email: refreshDecoded.user_email ?? accessDecoded.user_email,
        client_id: refreshDecoded.client_id ?? accessDecoded.client_id,
      };

      return { error: false, message: 'Token regenerated', data: this.createToken(payload) };
    } catch (err: any) {
      return { error: true, message: err?.message || 'Invalid refresh token', data: null };
    }
  }
}
