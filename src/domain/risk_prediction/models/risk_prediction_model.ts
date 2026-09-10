import { Model } from '../../../model';

/**
 * `RiskPredictionModel` – MongoDB schema for risk records and ML predictions (plan §10).
 * Append-only history: `kind` distinguishes a 'risk' entry from a 'prediction' entry.
 */
export class RiskPredictionModel extends Model {
  constructor() {
    super(
      'risk_predictions',
      {
        project_id: { type: String, required: true },
        kind: { type: String, required: true },
        risk_level: { type: String, default: 'LOW' },
        predicted_date: { type: Date },
        target_date: { type: Date },
        confidence_score: { type: Number, default: 0 },
        factors: { type: Array, default: [] },
        summary: { type: String },
        is_deleted: { type: Boolean, default: false },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        deleted_at: { type: Date },
      },
      { versionKey: false }
    );
  }
}
