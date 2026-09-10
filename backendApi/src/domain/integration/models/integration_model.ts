import { IServiceResult } from '../../../helper/common_interface';
import { Model } from '../../../model';

/**
 * IntegrationModel – MongoDB schema for external provider connections.
 *
 * Every integration ALWAYS belongs to a project (plan §04/§05 lineage):
 *   project_id  – Owning project (required). All synced artifacts inherit it.
 *   organization_id – Optional denormalized org scope for tenant filtering.
 *
 * Fields:
 *   provider            – github | gitlab | taiga | jira | planner | azure_devops | other
 *   repository_name     – Identifier of the repo or project in the provider
 *   repository_organization – Optional org/space name
 *   repository_url      – Optional full URL to the repo
 *   token               – OAuth or API token for the provider
 *   sync_status         – idle | syncing | success | partial | failed
 *   last_sync_at        – Timestamp of the last sync run
 *   status              – Numeric status code (0=inactive, 1=active, 2=error)
 *   is_deleted          – Soft‑delete flag
 *   created_at, updated_at, deleted_at – Timestamps
 */
export class IntegrationModel extends Model {
  constructor() {
    super(
      'integrations',
      {
        project_id: { type: String, required: true, index: true },
        organization_id: { type: String, index: true },
        provider: { type: String, required: true },
        repository_name: { type: String, required: true },
        repository_organization: { type: String },
        repository_url: { type: String },
        token: { type: String },
        sync_status: { type: String, default: 'idle' },
        last_sync_at: { type: Date },
        status: { type: Number, default: 0 },
        is_deleted: { type: Boolean, default: false },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        deleted_at: { type: Date },
      },
      { versionKey: false }
    );
  }
}
