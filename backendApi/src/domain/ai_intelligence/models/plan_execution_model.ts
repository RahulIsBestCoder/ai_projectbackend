import { Model } from '../../../model';

/**
 * `PlanExecutionModel` – MongoDB schema for the execution checklist of an
 * accepted AI plan. One row per checkable item (sprint, task, milestone,
 * deadline or dependency), linked to its `ai_plans` document by `plan_id`.
 * This storage is deliberately separate from the real `sprints` / `work_items`
 * collections — accepting a plan never writes to those.
 */
export class PlanExecutionModel extends Model {
  constructor() {
    super(
      'plan_execution_items',
      {
        plan_id: { type: String, required: true },
        project_id: { type: String },
        kind: { type: String, required: true },
        ref_key: { type: String, required: true },
        parent_key: { type: String },
        title: { type: String, required: true },
        description: { type: String },
        sequence: { type: Number, default: 0 },
        meta: { type: Object, default: {} },
        is_completed: { type: Boolean, default: false },
        completed_at: { type: Date },
        is_deleted: { type: Boolean, default: false },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        deleted_at: { type: Date },
      },
      { versionKey: false }
    );
  }
}
