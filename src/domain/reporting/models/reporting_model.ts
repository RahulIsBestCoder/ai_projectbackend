import { Model } from '../../../model';

/**
 * `ReportingModel` – MongoDB schema for report definitions and generation jobs (plan §12).
 */
export class ReportingModel extends Model {
  constructor() {
    super(
      'reports',
      {
        project_id: { type: String, required: true },
        name: { type: String, required: true },
        definition: { type: Object, default: {} },
        format: { type: String, default: 'pdf' },
        status: { type: String, default: 'pending' },
        artifact_url: { type: String },
        is_deleted: { type: Boolean, default: false },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        deleted_at: { type: Date },
      },
      { versionKey: false }
    );
  }
}
