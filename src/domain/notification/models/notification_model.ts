import { Model } from '../../../model';

/**
 * `NotificationModel` – MongoDB schema for user-facing notifications (plan §13).
 */
export class NotificationModel extends Model {
  constructor() {
    super(
      'notifications',
      {
        user_id: { type: String, required: true, index: true },
        // Optional project scope — project-scoped notifications (risk alerts,
        // sprint events) carry it; account-level ones may omit it.
        project_id: { type: String, index: true },
        title: { type: String, required: true },
        body: { type: String },
        type: { type: String, default: 'info' },
        channel: { type: String, default: 'in_app' },
        is_read: { type: Boolean, default: false },
        read_at: { type: Date },
        is_deleted: { type: Boolean, default: false },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        deleted_at: { type: Date },
      },
      { versionKey: false }
    );
  }
}
