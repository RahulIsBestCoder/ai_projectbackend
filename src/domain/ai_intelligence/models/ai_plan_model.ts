import { Model } from '../../../model';

/**
 * `AiPlanModel` – MongoDB schema for AI-generated sprint/deadline plans.
 * Each record stores the original planning input plus the structured plan
 * JSON (sprints, tasks, milestones, deadlines) produced by the AI provider,
 * or by the deterministic fallback when the provider is unavailable.
 */
export class AiPlanModel extends Model {
  constructor() {
    super(
      'ai_plans',
      {
        project_id: { type: String },
        title: { type: String, required: true },
        input: { type: Object, default: {} },
        plan: { type: Object, required: true },
        provider: { type: String, default: 'google' },
        model: { type: String },
        prompt: { type: String },
        is_deleted: { type: Boolean, default: false },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        deleted_at: { type: Date },
      },
      { versionKey: false }
    );
  }
}