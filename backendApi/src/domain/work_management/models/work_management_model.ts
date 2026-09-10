import { Model } from '../../../model';

/**
 * `WorkManagementModel` – MongoDB schema for provider-agnostic work items (plan §07).
 * Canonical abstraction over Jira Stories / Taiga Tasks / GitHub Issues.
 */
export class WorkManagementModel extends Model {
  constructor() {
    super(
      'work_items',
      {
        project_id: { type: String, required: true },
        integration_id: { type: String },
        external_id: { type: String },
        title: { type: String, required: true },
        description: { type: String },
        type: { type: String, default: 'task' },
        status: { type: String, default: 'todo' },
        priority: { type: String, default: 'medium' },
        assignee_id: { type: String },
        sprint_id: { type: String },
        story_points: { type: Number, default: 0 },
        is_deleted: { type: Boolean, default: false },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        deleted_at: { type: Date },
      },
      { versionKey: false }
    );
  }
}
