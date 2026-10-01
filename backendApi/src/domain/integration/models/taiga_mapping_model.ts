import { Model } from '../../../model';

/**
 * `TaigaMappingModel` — MongoDB schema for the `taiga_mappings` collection.
 *
 * Idempotency index: project_id + plan_id + entity_type + external_id.
 * Prevents duplicate Taiga records on re-publish.
 */
export class TaigaMappingModel extends Model {
  constructor() {
    super(
      'taiga_mappings',
      {
        project_id: { type: String, required: true },
        plan_id: { type: String, required: true },
        entity_type: { type: String, required: true },
        external_id: { type: String, required: true },
        taiga_id: { type: Number },
        taiga_ref: { type: Number },
        name: { type: String },
        taiga_project_id: { type: Number },
        /** Parent milestone (sprint) id - set on user stories and tasks. */
        taiga_milestone_id: { type: Number },
        /** Parent user story id - set on tasks. */
        taiga_user_story_id: { type: Number },
        /** pending | processing | success | failed | skipped */
        sync_status: { type: String, default: 'pending' },
        last_error: { type: String, default: null },
        last_synced_at: { type: Date, default: Date.now },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
      },
      { versionKey: false }
    );
  }
}
