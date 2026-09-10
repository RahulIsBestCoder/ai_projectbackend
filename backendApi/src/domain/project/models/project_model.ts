import { Model } from '../../../model';

export class ProjectModel extends Model {
  constructor() {
    super(
      'projects',
      {
        name: { type: String, required: true },
        description: { type: String },
        organization_id: { type: String, required: true },
        owner_id: { type: String, required: true },
        status: { type: Number, default: 1 },
        is_deleted: { type: Boolean, default: false },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        deleted_at: { type: Date },
      },
      { versionKey: false }
    );
  }
}
