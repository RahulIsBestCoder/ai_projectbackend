import crypto from 'crypto';

/**
 * `Encryption` — AES for the optional transport envelope (plan §1, §10).
 * `encryptResponse` / `decryptRequest` operate on hex strings. Toggled by
 * `ENCRYPTED_DATA=1`. Published on `global.encrypt_decrypt_helper`.
 *
 * The key is derived via SHA-256 of `SECRET_KEY` so any-length secrets work;
 * the IV is `IV` normalised to 16 bytes.
 */
export class Encryption {
  private readonly algorithm: string;
  private readonly key: Buffer;
  private readonly iv: Buffer;

  constructor() {
    this.algorithm = process.env.ALGORITHM || 'aes-256-cbc';
    this.key = crypto.createHash('sha256').update(String(process.env.SECRET_KEY || 'secret')).digest();
    this.iv = Buffer.from(String(process.env.IV || '1234567890123456').padEnd(16, '0').slice(0, 16));
  }

  public encryptResponse(data: string): string {
    const cipher = crypto.createCipheriv(this.algorithm, this.key, this.iv);
    return Buffer.concat([cipher.update(Buffer.from(data, 'utf8')), cipher.final()]).toString('hex');
  }

  public decryptRequest(encData: string): string {
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, this.iv);
    return Buffer.concat([decipher.update(Buffer.from(encData, 'hex')), decipher.final()]).toString('utf8');
  }
}
