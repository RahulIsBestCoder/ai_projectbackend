/**
 * `taiga_publish_interface.ts` — Type contracts for the Taiga publish pipeline.
 *
 * The publish flow converts an approved AI plan (stored in `ai_plans`)
 * into Taiga entities (milestones, sprints, user stories, tasks) via the
 * Taiga REST API, storing idempotency mappings in `taiga_mappings`.
 */

/** Result of a single-stage publish (milestones, sprints, stories, or tasks). */
export interface IPublishStageResult {
  created: number;
  updated: number;
  failed: number;
  errors: IPublishError[];
}

/** A single failed entity within a publish stage. */
export interface IPublishError {
  external_id: string;
  type: 'milestone' | 'sprint' | 'user_story' | 'task';
  error: string;
}

/** Full publish result returned to the controller. */
export interface IPublishResult {
  status: 'completed' | 'partial' | 'failed';
  plan_id: string;
  taiga_project_id: number;
  taiga_project_slug: string;
  publish_id: string;
  milestones: IPublishStageResult;
  sprints: IPublishStageResult;
  user_stories: IPublishStageResult;
  tasks: IPublishStageResult;
}

/** Preview (dry-run) result — no writes to Taiga. */
export interface IPreviewResult {
  milestones: { create: number; update: number; skip: number };
  sprints: { create: number; update: number; skip: number };
  user_stories: { create: number; update: number; skip: number };
  tasks: { create: number; update: number; skip: number };
  missing_assignee_mappings: string[];
  /** Resolved Taiga project for the preview (null when it could not be resolved). */
  taiga_project_id?: number | null;
  taiga_project_slug?: string;
}

/** Request body for POST /v1/projects/:id/publish-to-taiga. */
export interface IPublishRequest {
  mode?: 'bulk';
  create_missing?: boolean;
  update_existing?: boolean;
  dry_run?: boolean;
  integrationId?: string;
  integration_id?: string;
}

/** Request body for POST /v1/plans/:planId/create-in-taiga (and its aliases). */
export interface ICreateRequest {
  /** `create` fails when anything is already mapped; `sync` creates missing + updates mapped. */
  mode?: 'create' | 'sync';
  /** Preview only - no writes to Taiga and no writes to `taiga_mappings`. */
  dry_run?: boolean;
  /** `true` creates items whose role has no Taiga user mapping (as warnings) instead of failing. */
  allow_unassigned?: boolean;
  integrationId?: string;
  integration_id?: string;
}

/** Request body for POST /v1/projects/:id/taiga/connect. */
export interface IConnectRequest {
  base_url?: string;
  project_id?: number;
  token?: string;
  username?: string;
  password?: string;
}

/** Request body for POST /v1/projects/:id/taiga/user-mapping. */
export interface IUserMappingRequest {
  role: string;
  taiga_user_id: number;
}

/** Lightweight view of a Taiga project's metadata. */
export interface ITaigaMetadata {
  projectId: number;
  slug: string;
  users: Array<{ id: number; username: string; full_name: string }>;
  priorities: Array<{ id: number; name: string; order: number }>;
  severities: Array<{ id: number; name: string; order: number }>;
  taskTypes: Array<{ id: number; name: string; order: number }>;
  taskStatuses: Array<{ id: number; name: string; is_closed: boolean; order: number }>;
  /** Needed to set a User Story status (sprint-level stories use the first non-closed one). */
  userStoryStatuses: Array<{ id: number; name: string; is_closed: boolean; order: number }>;
  points: Array<{ id: number; name: string; value: number; order: number }>;
}
