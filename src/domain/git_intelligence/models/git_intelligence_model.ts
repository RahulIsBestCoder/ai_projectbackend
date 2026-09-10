import { Model } from '../../../model';

/**
 * GitIntelligenceModel – repository registry (plan §06).
 * A repository ALWAYS belongs to a project and traces back to the
 * integration (github/taiga/planner/...) that produced it.
 */
export class GitIntelligenceModel extends Model {
  constructor() {
    super(
      'git_intelligence',
      {
        project_id: { type: String, required: true, index: true },
        organization_id: { type: String, index: true },
        integration_id: { type: String, index: true },
        repository_id: { type: String, required: true },
        name: { type: String },
        full_name: { type: String },
        url: { type: String },
        default_branch: { type: String },
        language: { type: String },
        provider: { type: String, required: true },
        token: { type: String },
        status: { type: Number, default: 0 },
        is_deleted: { type: Boolean, default: false },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        deleted_at: { type: Date },
      },
      // NOTE: pin the exact collection name — mongoose would otherwise
      // pluralize the model name to `git_intelligences` (plan §5.5).
      { versionKey: false, collection: 'git_intelligence' }
    );
  }
}
