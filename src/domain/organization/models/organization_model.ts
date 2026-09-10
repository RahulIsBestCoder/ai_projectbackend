import { Model } from '../../../model';
export class OrganizationModel extends Model {
  constructor() {
    super(
      'organizations',
      {
        organization_id: {
          type: Number,
          primaryKey: true,
          autoIncrement: true,
        },
        name: { type: String, required: true },
        description: { type: String },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        deleted_at: { type: Date },
        created_by: { type: Number },
        updated_by: { type: Number },
        deleted_by: { type: Number },
      },
      { versionKey: false }
    );
  }
}
