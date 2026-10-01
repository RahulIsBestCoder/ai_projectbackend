import { Model } from '../../../model';

export class ProjectModel extends Model {
  constructor() {
    const contextSnapshot = {
      text: { type: String, default: '' },
      generated_by: { type: String },
      sources: [{ type: String }],
      line_count: { type: Number, default: 0 },
      char_count: { type: Number, default: 0 },
      trigger: { type: String },
      updated_at: { type: Date },
    };
    super(
      'projects',
      {
        name: { type: String, required: true },
        description: { type: String },
        organization_id: { type: String, required: true },
        owner_id: { type: String, required: true },
        status: { type: Number, default: 1 },
        target_date: { type: Date },
        project_context: {
          ...contextSnapshot,
          git: contextSnapshot,
          taiga: contextSnapshot,
          plan: contextSnapshot,
          combined: contextSnapshot,
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
