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
        scope: { type: [String], default: [] },
        report_content: { type: String, default: '' },
        /** Stable cache key for the inputs that produced report_data. */
        generation_key: { type: String, index: true },
        /** Canonical AI/fallback JSON used by every renderer and subsequent read. */
        report_data: { type: Object, default: null },
        generated_at: { type: Date },
        is_deleted: { type: Boolean, default: false },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        deleted_at: { type: Date },
      },
      { versionKey: false }
    );
  }
}
