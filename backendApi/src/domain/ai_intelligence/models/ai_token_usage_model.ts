import { Model } from '../../../model';

/**
 * `AiTokenUsageModel` – MongoDB schema for AI token-usage metering.
 * One row per AI call: which provider/model served it, which endpoint
 * triggered it (chat / analyze / summary / plan ...), and the token
 * counts. The AI panel tabs aggregate this collection for the sliding
 * 5-hour window ("used tokens per 5 hours").
 */
export class AiTokenUsageModel extends Model {
  constructor() {
    super(
      'ai_token_usage',
      {
        provider: { type: String, required: true, index: true },
        model: { type: String },
        endpoint: { type: String },
        project_id: { type: String, index: true },
        request_id: { type: String },
        prompt_tokens: { type: Number, default: 0 },
        completion_tokens: { type: Number, default: 0 },
        total_tokens: { type: Number, default: 0 },
        is_deleted: { type: Boolean, default: false },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        deleted_at: { type: Date },
      },
      { versionKey: false }
    );
  }
}