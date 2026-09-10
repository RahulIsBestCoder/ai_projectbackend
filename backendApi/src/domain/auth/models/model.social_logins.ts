import { Model } from '../../../model';

/**
 * `social_logins` collection (plan §7.1). Presence of a row blocks the
 * password-reset chain for that email.
 */
export class socialLoginsModel extends Model {
  constructor() {
    super(
      'social_logins',
      {
        user_id: { type: String, default: '' },
        email: { type: String, index: true },
        provider: { type: String, default: '' },
        provider_id: { type: String, default: '' },
        created_at: { type: Date, default: Date.now },
      },
      { versionKey: false },
    );
  }
}
