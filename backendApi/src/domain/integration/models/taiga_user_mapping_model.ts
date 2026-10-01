import { Model } from '../../../model';

/**
 * `TaigaUserMappingModel` — MongoDB schema for the `taiga_user_mappings` collection.
 *
 * Maps internal role names (backend, frontend, app, qa) to Taiga user IDs.
 * Unique on project_id + role.
 */
export class TaigaUserMappingModel extends Model {
  constructor() {
    super(
      'taiga_user_mappings',
      {
        project_id: { type: String, required: true },
        role: { type: String, required: true },
        taiga_user_id: { type: Number, required: true },
        taiga_username: { type: String },
        taiga_full_name: { type: String },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
      },
      { versionKey: false }
    );
  }
}
