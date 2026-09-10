import { Model } from '../../../model';

/**
 * `login_tokens` collection (plan §7.1). Holds the issued `auth_code` and the
 * resulting AES-wrapped access / refresh tokens plus their expiry strings.
 */
export class loginTokensModel extends Model {
  constructor() {
    super(
      'login_tokens',
      {
        user_id: { type: String, index: true },
        client_id: { type: String, default: '' },
        auth_code: { type: String, default: null },
        access_token: { type: String, default: null },
        refresh_token: { type: String, default: null },
        access_token_expire: { type: String, default: null },
        refresh_token_expire: { type: String, default: null },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
      },
      { versionKey: false },
    );
  }
}
