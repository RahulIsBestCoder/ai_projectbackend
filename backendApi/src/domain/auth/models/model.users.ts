import { Model } from '../../../model';

/**
 * `users` collection (plan §14.1). A string `user_id` business key lives
 * alongside `_id` (plan §15).
 */
export class usersModel extends Model {
  constructor() {
    super(
      'users',
      {
        user_id: { type: String, index: true },
        first_name: { type: String, default: '' },
        last_name: { type: String, default: '' },
        email: { type: String, index: true },
        password_hash: { type: String, default: '' },
        user_status: { type: Number, default: 1 }, // 0 = inactive
        role_id: { type: String, default: '' },
        department_id: { type: String, default: '' },
        profile_photo: { type: String, default: '' },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
      },
      { versionKey: false },
    );
  }
}
