import { Model } from '../../../model';

/**
 * `AnalyticsModel` – MongoDB schema for deterministic metric snapshots (plan §09).
 * Append-only: one row per computed metric per period. `calculation_version`
 * is stored so historical results can be reproduced.
 */
export class AnalyticsModel extends Model {
  constructor() {
    super(
      'analytics_snapshots',
      {
        project_id: { type: String, required: true },
        metric_type: { type: String, required: true },
        value: { type: Number, required: true },
        breakdown: { type: Object, default: {} },
        period: { type: String, default: 'daily' },
        calculation_version: { type: String, default: 'v1' },
        captured_at: { type: Date, default: Date.now },
        is_deleted: { type: Boolean, default: false },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        deleted_at: { type: Date },
      },
      { versionKey: false }
    );
  }
}
