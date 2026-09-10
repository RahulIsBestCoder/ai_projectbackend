import { Model } from '../../../model';

/**
 * `user_logins` collection (plan §7.1). One row per user + browser; tracks the
 * current session id and login state.
 */
export class userLoginsModel extends Model {
  constructor() {
    super(
      'user_logins',
      {
        user_id: { type: String, index: true },
        session_id: { type: String, default: '' },
        browser: {
          id: { type: String, default: '' },
          name: { type: String, default: '' },
          version: { type: String, default: '' },
        },
        is_logged_in: { type: Number, default: 1 },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
      },
      { versionKey: false },
    );
  }
}
