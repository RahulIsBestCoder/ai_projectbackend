import { Model } from '../../../model';

/**
 * `SprintIntelligenceModel` – MongoDB schema for iteration tracking (plan §08).
 */
export class SprintIntelligenceModel extends Model {
  constructor() {
    super(
      'sprints',
      {
        project_id: { type: String, required: true },
        name: { type: String, required: true },
        goal: { type: String },
        start_date: { type: Date },
        end_date: { type: Date },
        status: { type: String, default: 'planned' },
        planned_points: { type: Number, default: 0 },
        completed_points: { type: Number, default: 0 },
        retrospective: {
          went_well: [{ type: String }],
          improve: [{ type: String }],
          action_items: [{ type: String }],
        },
        is_deleted: { type: Boolean, default: false },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        deleted_at: { type: Date },
      },
      { versionKey: false }
    );
  }
}
