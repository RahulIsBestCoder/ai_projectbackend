# "Create in Taiga" Button: API and UI instructions

## One-click publishing (current flow)

**Existing sprint rule:** Creation is allowed only when the connected Taiga
project has no sprints. Project status reads Taiga's milestone list and returns
`has_sprints`, `can_create_sprints`, and `creation_blocked_reason`. The UI disables
publishing when creation is not allowed, checks again on click, and displays
“Sprints already exist” for occupied projects. The backend independently checks
before preview/publishing and returns `TAIGA_SPRINTS_EXIST` without writes when
any sprint exists, including closed or manually created sprints. This rule applies
to create, sync, retry and project-scoped aliases. It supersedes the earlier
resume/update behavior below; a partial publish that already created a sprint
cannot be retried through this flow.

The accepted plan's **Create in Taiga** button directly sends
`POST /v1/plans/:planId/create-in-taiga` with
`{"mode":"sync","dry_run":false,"allow_unassigned":true}`.
No preview or second confirmation is required. The request processes every sprint
and its tasks, creating one Taiga milestone and user story per sprint. The button
is disabled while publishing. Repeating the action updates mapped items and
creates missing items. Unmapped assignee roles produce warnings and unassigned
tasks rather than stopping creation. Failures are displayed with a retry action.
Only a completed publish marks the plan published; partial results retain the
previous plan status and store `publish_status: "partial"`.

The preview API remains available for other clients. `allow_unassigned` defaults
to true on publish; explicitly send false to enforce role mappings. The older
preview-first UI instructions below describe the previous flow.

For: the frontend developer working on the plan detail / plan execution screen and `lib/api/taiga.ts`.

Adds one button to the plan flow: after an AI plan is **accepted**, the user can push the whole
plan into their connected Taiga project — milestones, user stories and tasks — from the browser,
without ever handling a Taiga token.

The endpoint is plan-scoped: the client only sends the plan id; the backend resolves the project
and the Taiga connection.

**Taiga structure produced:** one milestone + one user story per sprint, with that sprint's tasks
under the story.

> **Status (implemented):** the flow described below is built in the frontend repo
> (`test-plan-api`) — `lib/api/plans.ts` (`previewPlanTaiga`, `createPlanInTaiga`,
> `getPlanTaigaSync`, `retryPlanTaiga`), `components/TaigaPreviewModal.tsx`
> (preview → confirm, unassigned-option, blocking errors) and the "Create in Taiga"
> button in `components/PlansView.tsx`. §3's state machine is realised there; the
> `integrationId` parameter of the legacy project-scoped helpers is no longer needed.

## 1. API contract

```http
POST /v1/plans/:planId/create-in-taiga
Authorization: Bearer <access_token>
Content-Type: application/json

{ "mode": "create", "dry_run": false, "allow_unassigned": false }
```

| Body field | Type | Default | Use |
| --- | --- | --- | --- |
| `mode` | `create` \| `sync` | `create` | `create` for the first push (fails if anything already exists). `sync` for re-runs: creates what is missing and updates what is mapped. |
| `dry_run` | boolean | `false` | Validate only. Nothing is written to Taiga. Use it for the confirm step. |
| `allow_unassigned` | boolean | `false` | `false` = fail if a role has no mapped Taiga user. `true` = create those items unassigned and report warnings. |
| `integrationId` | string | auto | Only send it if the project has more than one Taiga integration. |
| `refresh_local` | boolean | `true` | Server refreshes the local sprint/work-item mirror afterwards. Leave it as-is. |

```http
POST /v1/plans/:planId/create-in-taiga/preview   -> same body, always a dry run
GET  /v1/plans/:planId/taiga-sync                -> last run + per-entity mapping summary
POST /v1/plans/:planId/taiga-sync/retry          -> resume items that are pending or failed
```

- Requires a valid login token. Taiga plan routes do not require project ownership or membership; any authenticated caller with a plan ID can publish or inspect its Taiga sync.
- It is a **long request** (one Taiga API call per entity). Allow up to 2 minutes and never
  retry automatically.
- Unwrap the envelope and treat `response.status.action_status === false` as an error even at
  HTTP 200.

### Response (`response.dataset`)

```ts
interface PlanTaigaSyncResult {
  sync_id: string;
  status: 'completed' | 'partial' | 'failed';
  dry_run: boolean;
  mode: 'create' | 'sync';
  plan_id: string;
  taiga_project: { id: number; slug: string; name: string };
  summary: {
    milestones:   { created: number; updated: number; skipped: number; failed: number };
    user_stories: { created: number; updated: number; skipped: number; failed: number };
    tasks:        { created: number; updated: number; skipped: number; failed: number };
  };
  mappings: Array<{ source_type: 'sprint' | 'user_story' | 'task';
                    source_id: string; taiga_type: 'milestone' | 'userstory' | 'task';
                    taiga_id: number; taiga_ref?: number }>;
  warnings: Array<{ source_id: string;
                    type: 'USER_ROLE_UNMAPPED' | 'STATUS_FALLBACK' | 'INVALID_DATE';
                    value?: string }>;
  errors: Array<{ source_id: string; entity_type: string; field?: string; error: string }>;
  started_at: string;
  finished_at: string;
}
```

Example preview (`dry_run: true`):

```json
{
  "sync_id": "TAIGA-SYNC-20260918-0001",
  "status": "completed",
  "dry_run": true,
  "mode": "create",
  "plan_id": "66f0...",
  "taiga_project": { "id": 15, "slug": "mgroc", "name": "MGROC" },
  "summary": {
    "milestones":   { "created": 2, "updated": 0, "skipped": 0, "failed": 0 },
    "user_stories": { "created": 2, "updated": 0, "skipped": 0, "failed": 0 },
    "tasks":        { "created": 12, "updated": 0, "skipped": 0, "failed": 0 }
  },
  "mappings": [],
  "warnings": [ { "source_id": "sprint-2-task-3", "type": "USER_ROLE_UNMAPPED", "value": "qa" } ],
  "errors": [],
  "started_at": "2026-09-18T05:30:00.000Z",
  "finished_at": "2026-09-18T05:30:01.100Z"
}
```

Note `milestones.created === user_stories.created` — that is the sprint-level mapping (1 milestone
and 1 user story per sprint), so a mismatch means a sprint is missing its story. `tasks.created`
is the total number of tasks across all sprints.

`GET /v1/plans/:planId/taiga-sync` returns the same shape for the latest run plus
`last_sync_at` and `plan_published: boolean` — use it for the "Last synced ..." line.

> **Compatibility note.** The create/preview responses also carry the older publish fields
> (`publish_id`, `taiga_project_id`, `taiga_project_slug`, `missing_assignee_mappings` and the
> per-stage `milestones` / `sprints` / `user_stories` / `tasks` objects). Ignore them — the
> envelope above is authoritative. `WARNING`/`errors` are populated for entity failures; the
> `mappings[]` array lists every internal key already linked to a Taiga object, which is what
> makes a second run update instead of duplicating.

## 2. Placement

- On the **plan detail** (or plan execution) screen, next to **Accept plan** / at the top-right
  of the plan header: **Create in Taiga**.
- Show it only when all of these hold:
  - the plan is accepted (`plan.status` is `accepted` or `published`);
  - the plan belongs to a project (`plan.project_id` is set);
  - the project has a Taiga integration (`GET /v1/projects/:projectId/taiga/status` ->
    `dataset.connected === true`).
- When the plan has no project or no Taiga connection, render the button disabled with a hint:
  - no project -> "This plan isn't linked to a project."
  - no Taiga -> "Connect Taiga for this project to publish the plan."
- Under the button show "Last synced 2h ago" from `GET .../taiga-sync` (`finished_at`), or the
  plan's `published_at` on first load.

## 3. Button behaviour

1. **Labels by state**
   - never published -> **Create in Taiga**
   - `plan.status === 'published'` -> **Sync to Taiga**
   - `publish_status === 'partial'` -> **Retry Taiga sync**
2. **First click** -> call `POST .../create-in-taiga/preview` with `dry_run: true`.
   - Disable the button, set `aria-busy="true"`, label **Checking plan...**.
   - Keep the plan content visible; show a small inline spinner.
3. **Confirm dialog** with the preview numbers:
   - "This will create **2 milestones, 2 user stories and 12 tasks** in Taiga project
     **MGROC** (mgroc)." Add: "1 milestone + 1 user story per sprint, with that sprint's tasks
     under the story."
   - If `warnings` contain `USER_ROLE_UNMAPPED`, list the roles and offer a checkbox
     "Create these items unassigned" that sets `allow_unassigned: true` on the confirm call.
   - If `errors` is not empty, show them as a blocking list and only offer Close.
4. **Confirm** -> `POST .../create-in-taiga` (`mode: 'create'` first time, `'sync'` afterwards).
   - Button label **Creating in Taiga...**, keyboard focus trapped in the dialog.
5. **On success**
   - Show a result panel: per-entity `created / updated / skipped / failed` counts, the Taiga
     project link (`https://tree.taiga.io/project/<slug>/` for cloud; use the integration's
     base URL for self-hosted), and the `sync_id`.
   - Toast: "Plan created in Taiga".
   - Invalidate cached queries for the plan, plan execution, the project dashboard/sprints and
     the Taiga status card.
   - Flip the button to **Sync to Taiga**.
6. **On `status: 'partial'`**
   - Keep the result visible, list `errors[]` rows ("Sprint 2 / Tasks / 'Add payment callback' -
     Taiga 400: ..."), and switch the button to **Retry Taiga sync**
     (`POST .../taiga-sync/retry`).
7. **On failure** -> see section 6. Re-enable the button whatever happens.

## 4. Rendering rules

| Data | UI treatment |
| --- | --- |
| `status: 'completed'` | Green check + counts + "Open in Taiga" link |
| `status: 'partial'` | Amber banner, error list, **Retry** button |
| `status: 'failed'` | Red banner, `errors[0].error` as the headline, **Retry** |
| `summary.*.skipped > 0` | Show as "unchanged", never as failures |
| `summary.milestones.created !== summary.user_stories.created` | Info chip "some sprints have no user story" (sprint-level mapping is 1:1) |
| `warnings[].type === 'USER_ROLE_UNMAPPED'` | "Created unassigned: qa" chips next to the counts |
| `warnings[].type === 'STATUS_FALLBACK'` | Tooltip: "Taiga default status used" |
| `dry_run: true` | Never render as if something was created - label it "Preview" |
| `errors[].field === 'status'` | Show `value` and the Taiga status error verbatim |

## 5. State model

```ts
type TaigaPublishState =
  | { phase: 'idle'; lastSyncedAt?: string }
  | { phase: 'previewing'; planId: string; startedAt: string }
  | { phase: 'confirming'; planId: string; preview: PlanTaigaSyncResult }
  | { phase: 'publishing'; planId: string; mode: 'create' | 'sync'; startedAt: string }
  | { phase: 'success'; planId: string; result: PlanTaigaSyncResult }
  | { phase: 'partial'; planId: string; result: PlanTaigaSyncResult }
  | { phase: 'error'; planId: string; message: string; retryable: boolean };
```

- Block a second click while `phase` is `previewing` or `publishing`.
- If the user switches plan or project mid-request, apply the result only to the `planId` the
  request started from.
- `publishing` does **not** block navigation; on return, re-read `GET .../taiga-sync`.

## 6. Errors

| Response | UI |
| --- | --- |
| 401 | Existing token refresh or login flow |
| 403 `Project access required to sync.` | Hide the button, show "You don't have access to publish this plan" |
| `Plan not found.` | Toast + refresh the plan list |
| `PLAN_NOT_ACCEPTED: ...` | Disable the button, tooltip "Accept the plan first" |
| `Plan has no project. ...` | Disable with the no-project hint |
| `Connect Taiga for this project first.` | Show a **Connect Taiga** call to action (project integrations screen) |
| `ALREADY_EXISTS: ...` | Show what exists, offer **Sync to Taiga** instead (it updates instead of failing) |
| `ASSIGNEE_MAPPING_MISSING: No Taiga user mapped to role 'qa'.` | Offer the "Create unassigned" retry (`allow_unassigned: true`) or link to the Taiga user-mapping screen |
| Taiga 401/403 inside the run | "Taiga rejected the request - reconnect Taiga and retry." |
| Timeout / network error | "Taiga is taking longer than expected. Check the sync status in a minute." Offer **Retry**; the backend may still have finished |

## 7. Client service sketch

```ts
const unwrap = <T>(env: ApiEnvelope<T>): T => {
  if (!env.response.status.action_status) throw new Error(env.response.status.msg);
  return env.response.dataset;
};

previewPlanTaiga(planId: string, body: TaigaPublishRequest = {}) {
  return this.http.post<ApiEnvelope<PlanTaigaSyncResult>>(
    `/v1/plans/${planId}/create-in-taiga/preview`, { ...body, dry_run: true },
  ).pipe(timeout(60_000), map(unwrap));
}

publishPlanTaiga(planId: string, mode: 'create' | 'sync', options: { allowUnassigned?: boolean } = {}) {
  return this.http.post<ApiEnvelope<PlanTaigaSyncResult>>(
    `/v1/plans/${planId}/create-in-taiga`,
    { mode, dry_run: false, allow_unassigned: options.allowUnassigned ?? false },
  ).pipe(timeout(120_000), map(unwrap));
}

getPlanTaigaSync(planId: string) {
  return this.http.get<ApiEnvelope<PlanTaigaSyncResult>>(
    `/v1/plans/${planId}/taiga-sync`,
  ).pipe(map(unwrap));
}

retryPlanTaiga(planId: string) {
  return this.http.post<ApiEnvelope<PlanTaigaSyncResult>>(
    `/v1/plans/${planId}/taiga-sync/retry`, {},
  ).pipe(timeout(120_000), map(unwrap));
}
```

## 8. Relationship to other buttons

- **Accept plan** writes the plan's checkable items locally (`plan_execution_items`). Nothing
  reaches Taiga until **Create in Taiga** runs.
- **Create in Taiga** pushes the plan (milestones, user stories, tasks) into Taiga and stores the
  source-id -> Taiga-id mapping so later runs update instead of duplicating.
- **AI Sync** / `POST /v1/projects/:id/sync` pulls GitHub and Taiga data the other way (Taiga ->
  local sprints, work items, tasks). It is not required after publishing, but it makes the newly
  created items appear in every other view immediately.
- **Run AI assessment** should be refreshed after a publish so health/velocity include the new
  work items.

## 9. Acceptance checks

- The button appears only for an accepted plan whose project has a Taiga connection; otherwise it
  is disabled with the matching hint.
- Clicking once runs the preview; nothing is created in Taiga during preview.
- The confirm dialog shows the exact counts from the preview and blocks on `errors`.
- Confirming creates milestones, stories and tasks in Taiga; each task appears under its user
  story in Taiga.
- After publishing, opening the Taiga project shows each sprint as a milestone holding one user
  story with that sprint's tasks beneath it.
- A second run uses **Sync to Taiga** and creates no duplicates (button shows `created: 0`,
  `updated: N`).
- A partial run shows the failed rows and **Retry** completes the remainder.
- No Taiga credential is ever present in frontend code, storage or network payloads.
