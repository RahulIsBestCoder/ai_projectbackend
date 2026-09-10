import { Model } from '../../../model';
export class UserModel extends Model {
  constructor() {
    super(
      'users',
      {
        user_id: { type: Number, primaryKey: true, autoIncrement: true },
        full_name: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        password_hash: { type: String, required: true },
        is_active: { type: Boolean, default: true },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        deleted_at: { type: Date },
        created_by: { type: Number },
        updated_by: { type: Number },
        deleted_by: { type: Number },
      },
      { versionKey: false }
    );
  }
}
