import { Model } from '../../../model';

/**
 * `AiSessionModel` – MongoDB schema for chat session history (plan §11).
 * Stores conversation context for project-scoped AI interactions.
 */
export class AiSessionModel extends Model {
  constructor() {
    super(
      'ai_sessions',
      {
        project_id: { type: String },
        session_id: { type: String, required: true, unique: true },
        messages: [
          {
            role: { type: String, enum: ['user', 'assistant'], required: true },
            content: { type: String, required: true },
            timestamp: { type: Date, default: Date.now },
          },
        ],
        context_summary: { type: String },
        is_active: { type: Boolean, default: true },
        is_deleted: { type: Boolean, default: false },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        deleted_at: { type: Date },
      },
      { versionKey: false }
    );
  }
}
