import { Model } from '../../../model';
import { ITaigaTaskCreate } from '../interface/taiga_task_interface';

/**
 * `TaigaTaskModel` – MongoDB schema for the dedicated `taiga_tasks` collection.
 *
 * Stores a Taiga-task mirror during Taiga sync. Each document is linked to the
 * main internal project and the Taiga integration, and preserves the fields needed
 * to render a Taiga-style task/taskboard UI.
 */
export class TaigaTaskModel extends Model {
  constructor() {
    super(
      'taiga_tasks',
      {
        project_id: { type: String, required: true, index: true },
        integration_id: { type: String, required: true, index: true },
        external_id: { type: String, required: true },
        taiga_task_id: { type: Number, required: true },
        taiga_project_id: { type: Number, required: true },
        taiga_project_name: { type: String },
        taiga_project_slug: { type: String },
        taiga_milestone_id: { type: Number },
        taiga_milestone_slug: { type: String },
        user_story_id: { type: Number },
        user_story_ref: { type: Number },
        user_story_subject: { type: String },
        ref: { type: Number },
        subject: { type: String, required: true },
        description: { type: String },
        status: { type: Number, required: true },
        status_name: { type: String },
        status_color: { type: String },
        is_closed: { type: Boolean, default: false },
        is_blocked: { type: Boolean, default: false },
        blocked_note: { type: String },
        owner_id: { type: Number },
        owner_username: { type: String },
        owner_full_name: { type: String },
        assigned_to_id: { type: Number },
        assigned_to_username: { type: String },
        assigned_to_full_name: { type: String },
        created_date: { type: String },
        modified_date: { type: String },
        finished_date: { type: String },
        due_date: { type: String },
        due_date_status: { type: String },
        total_comments: { type: Number },
        us_order: { type: Number },
        taskboard_order: { type: Number },
        attachments_count: { type: Number },
        tags: { type: Array },
        synced_at: { type: Date, default: Date.now },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date },
        is_deleted: { type: Boolean, default: false },
        deleted_at: { type: Date },
      },
      { versionKey: false }
    );
  }

  /**
   * Build a bulk write ops array for the Taiga sync response.
   * One upsert per Taiga task, keyed on project_id + integration_id + taiga_task_id.
   */
  public buildSyncOps(
    projectId: string,
    integrationId: string,
    items: ITaigaTaskCreate[]
  ): any[] {
    return items.map((item) => ({
      updateOne: {
        filter: {
          project_id: projectId,
          integration_id: integrationId,
          taiga_task_id: item.taiga_task_id,
        },
        update: {
          $set: {
            ...item,
            external_id: `taiga-task-${item.taiga_task_id}`,
            updated_at: new Date(),
            synced_at: new Date(),
          },
          $setOnInsert: {
            is_deleted: false,
            created_at: new Date(),
          },
        },
        upsert: true,
      },
    }));
  }
}
