/**
 * `taiga_tasks` collection contract.
 *
 * Dedicated mirror of Taiga tasks pulled from:
 *   /tasks?project={projectId}&milestone={milestoneId}&include_attachments=1&order_by=us_order&q=
 *
 * One document per Taiga task, linked to the main internal project and integration.
 */

/*
 * Save decision (Taiga-style status UI):
 *   KEEP  — linkage (project/integration/taiga ids), task card (ref, subject,
 *           description, tags), status chip (status/status_name/color/is_closed/
 *           is_blocked), people names, dates, ordering (us_order/taskboard_order),
 *           counters (total_comments, attachments_count).
 *   SKIP  — full nested `*_extra_info` objects, tokenized photo URLs (they expire),
 *           full attachment metadata (keep count only), due_date_reason, version,
 *           watcher data.
 */
export interface ITaigaTaskCreate {
  project_id: string;
  integration_id: string;
  taiga_task_id: number;
  taiga_project_id: number;
  taiga_project_name?: string;
  taiga_project_slug?: string;
  taiga_milestone_id?: number;
  taiga_milestone_slug?: string;
  user_story_id?: number;
  user_story_ref?: number;
  user_story_subject?: string;
  ref?: number;
  subject: string;
  description?: string;
  status: number;
  status_name?: string;
  status_color?: string;
  is_closed: boolean;
  is_blocked: boolean;
  blocked_note?: string;
  owner_id?: number;
  owner_username?: string;
  owner_full_name?: string;
  assigned_to_id?: number | null;
  assigned_to_username?: string | null;
  assigned_to_full_name?: string | null;
  created_date?: string;
  modified_date?: string;
  finished_date?: string | null;
  due_date?: string | null;
  due_date_status?: string;
  total_comments?: number;
  us_order?: number;
  taskboard_order?: number;
  attachments_count?: number;
  tags?: string[];
}

export interface ITaigaTaskDoc extends ITaigaTaskCreate {
  _id?: any;
  external_id: string;
  synced_at: Date;
  created_at: Date;
  updated_at?: Date;
  is_deleted: boolean;
  deleted_at?: Date;
}
