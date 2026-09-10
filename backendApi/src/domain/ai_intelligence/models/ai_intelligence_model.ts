import { Model } from '../../../model';

/**
 * `AiIntelligenceModel` – MongoDB schema for cached AI outputs (plan §11).
 * Stores chat answers, analyses, summaries, insights, recommendations and
 * AI-written reports along with the provider/model that produced them.
 */
export class AiIntelligenceModel extends Model {
  constructor() {
    super(
      'ai_insights',
      {
        project_id: { type: String },
        type: { type: String, required: true },
        provider: { type: String, default: 'openai' },
        model: { type: String },
        prompt: { type: String },
        response: { type: String },
        context_meta: { type: Object, default: {} },
        cached: { type: Boolean, default: true },
        is_deleted: { type: Boolean, default: false },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        deleted_at: { type: Date },
      },
      { versionKey: false }
    );
  }
}
