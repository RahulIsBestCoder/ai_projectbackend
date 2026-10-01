# Taiga Publish: Backend Integration Plan (Sprint Plan -> Taiga API)

For: the backend developer working in `src/domain/integration` and `src/domain/ai_intelligence`.

Takes an accepted AI sprint plan (`ai_plans`) and creates it inside an existing Taiga
project through the Taiga REST API, idempotently, with a dry-run and resume support.
The Taiga token stays on the server and is never returned to the client.

Base URL: `https://api.taiga.io/api/v1` (self-hosted: replace host, keep `/api/v1`).
Reference: https://docs.taiga.io/api.html

---

## 1. What already exists

| Concern | Status | Location |
| --- | --- | --- |
| AI plan generation (`POST /v1/plans`, alias `/v1/ai/plans`) | exists, `status: 'draft'` | `app_routing.ts:45-54`, `ai_intelligence_service.ts` (`generatePlan`) |
| Accept plan -> `plan_execution_items`, `status: 'accepted'` | exists | `ai_intelligence_service.ts` (`acceptPlan`) |
| Taiga HTTP client (`get/post/patch/auth/getMetadata`) | exists | `src/domain/integration/service/taiga_client.ts` |
| Milestone / User Story / Task creation + mapping | exists | `taiga_publish_service.ts` (`publishPlan` :25, `createInTaiga` :74, `previewPlan` :145) |
| Mapping store `taiga_mappings` | exists | `models/taiga_mapping_model.ts` |
| Role -> Taiga user map `taiga_user_mappings` | exists | `models/taiga_user_mapping_model.ts` |
| Read-side Taiga mirror (`sprints`, `work_items`, `taiga_tasks`) | exists | `integration_service.ts` (`syncTaiga`), `project_data_refresh.ts` |
| Plan-level Taiga publish endpoints | **missing / unreachable** | see section 2 |

## 2. Blockers to fix first (the new button fails today without these)

1. **`createInTaiga` is not routed.** `taiga_controller.ts:120` is written and
   `taiga_route.ts` defines it, but nothing imports `taiga_route.ts`; `project_route.ts:66-73`
   registers only `publish-to-taiga` and `preview`. Result: 404.
2. **Impossible status gate.** `publishPlan` (:32), `createInTaiga` (:79) and `previewPlan`
   (:149) require `plan.status === 'approved'`, but `acceptPlan` sets `'accepted'` and nothing
   in the codebase ever sets `'approved'`. Every publish returns
   `Plan must be approved (current: accepted)`.
3. **Tasks are created without hierarchy.** `publishTasks` (:289-320) sends no `user_story`
   and no `milestone`, so Taiga tasks are orphaned (the Taiga spec requires `task.user_story`).
   Also `points` is sent on the task payload (:310) — Taiga may reject it; it belongs on the
   User Story, not the Task.
4. **Taiga project resolution is contradictory.** `buildClient` (:204-206) treats
   `integrations.repository_url` as the **API base**, while `parseSlug` (:216-222) expects the
   same field to contain `.../project/<slug>`. `connect` stores
   `repository_name = project_id` and `repository_url = base_url`, so `parseSlug` returns `v1`
   and `projectBySlug` fails. The spec wants the Taiga **project id** used directly:
   `GET /projects/{id}`.
5. **`userstory-statuses` is never fetched.** `taiga_client.ts:92-119` loads 6 metadata
   collections but not `userstory-statuses`, and no status is ever applied to a User Story.
6. **Duplicate milestones.** Plan `milestones[]` and plan `sprints[]` both become Taiga
   Milestones, so the same sprint shows twice. Sprint <-> Milestone must be 1:1.
7. **No sync-run record**, so a `GET .../taiga-sync` status endpoint and `retry` would have
   nothing to read.
8. **`/v1/plans` has no `validateToken`** (`app_routing.ts:47-54`). Do not inherit this for
   the new endpoints — they must require auth.

## 3. Internal -> Taiga mapping (LOCKED: sprint-level)

| Internal (AI plan) | Taiga object | Fields |
| --- | --- | --- |
| Project | Project (existing, never auto-created) | `GET /projects/{id}` |
| `plan.sprints[]` | Milestone | `project`, `name`, `description` (= `goal`), `estimated_start`, `estimated_finish` |
| `plan.sprints[]` (1:1 with the milestone) | User Story | `project`, `milestone`, `subject` (= `sprint.name`), `description` (= `sprint.goal`), `status` |
| `plan.sprints[].tasks[]` | Task | `project`, `milestone`, `user_story`, `subject`, `description`, `status`, `assigned_to`, `us_order`, `taskboard_order` |
| `sprint.start_date` / `end_date` / `deadline` | Milestone dates | `estimated_start`, `estimated_finish` |
| `task.assignee_role` | `assigned_to` (numeric user id) | via `taiga_user_mappings` (role -> Taiga user) |
| `task.priority` | Task priority id | via `priorities` metadata |
| sprint `planned_points` | User Story points | via `points` metadata (User Story only — **never** on Task) |

**Locked mapping (sprint-level).** One User Story per sprint (`subject` = `sprint.name`,
`description` = `sprint.goal`); every `sprint.tasks[]` entry becomes a Taiga Task with
`user_story` = that story's id and `milestone` = that sprint's milestone. `plan.milestones[]`
and `plan.deadlines[]` are **not pushed** (they would duplicate the sprint milestones) — they
stay in the local execution view. Feature-level User Stories remain a Phase-4 option (the AI
plan emits `features[]` per sprint, then one story per feature) and require no change to
endpoints, mappings or UI.

Stable source ids (the keys written into `taiga_mappings.external_id`):

| Entity | `external_id` | Notes |
| --- | --- | --- |
| Milestone | `sprint-N` | `N` = 1-based sprint index (`sprint_id`/`id` when the AI provides one) |
| User Story | `story_sprint-N` | matches `publishUserStories`' existing `story_<sprint>` convention (:271) |
| Task | `sprint-N-task-M` | `M` = 1-based task index inside the sprint |

These are the same ref keys `acceptPlan` writes into `plan_execution_items.ref_key`, so the
internal execution checkboxes and the Taiga rows line up 1:1 and a future
"done in Taiga <-> checked here" join is trivial.

## 4. New endpoints

```
POST /v1/plans/:planId/create-in-taiga          <- the UI button (create | sync)
POST /v1/plans/:planId/create-in-taiga/preview  <- confirm modal / dry-run
GET  /v1/plans/:planId/taiga-sync               <- sync status + mapping summary
POST /v1/plans/:planId/taiga-sync/retry         <- resume failed/pending items
```

Aliases (same handlers, zero extra logic): `/v1/ai/plans/:planId/...` and the project-scoped
`/v1/projects/:projectId/plans/:planId/{create-in-taiga,publish-to-taiga,publish-to-taiga/preview}`.

Auth: `common_middleware.validateToken` on all four; the project-scoped alias additionally uses
`requireSyncAccess`. The plan-level route resolves the project from the plan
(`ai_plans.project_id`), so the client only sends `planId`.

### Request
```json
{
  "mode": "create",
  "dry_run": false,
  "integrationId": "optional-object-id",
  "taiga_project_id": 15,
  "base_url": "https://api.taiga.io/api/v1",
  "allow_unassigned": false,
  "refresh_local": true
}
```

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `mode` | `create \| sync` | `create` | `create` fails fast if any entity is already mapped; `sync` creates missing and PATCHes mapped |
| `dry_run` | boolean | `false` | validate + diff only, zero writes to Taiga and zero writes to `taiga_mappings` |
| `integrationId` | string | auto | auto-discovered from the plan's project; send only to force a specific Taiga integration |
| `taiga_project_id` / `base_url` | number / string | from integration doc | optional override; also enable the env-credential fallback |
| `allow_unassigned` | boolean | `false` | `false` = strict (unmapped role -> error); `true` = create unassigned + warning |
| `refresh_local` | boolean | `true` | after success, refresh `sprints`/`work_items` mirror + project context |

### Success response (`response.dataset`)
```ts
interface PlanTaigaSyncResult {
  sync_id: string;                       // TAIGA-SYNC-20260918-0001
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
  mappings: Array<{ source_type: 'sprint'|'user_story'|'task'; source_id: string;
                    taiga_type: 'milestone'|'userstory'|'task'; taiga_id: number; taiga_ref?: number }>;
  warnings: Array<{ source_id: string; type: 'USER_ROLE_UNMAPPED'|'STATUS_FALLBACK'|'INVALID_DATE'; value?: string }>;
  errors:   Array<{ source_id: string; entity_type: string; field?: string; error: string }>;
  started_at: string; finished_at: string;
}
```

## 5. Backend flow

```
POST /v1/plans/:planId/create-in-taiga
        |
        +- validate body (mode enum, dry_run boolean)
        +- load plan        (ai_plans, is_deleted:false)        -> 404 if missing
        +- status gate      draft -> 400 ; accepted|approved|published -> continue
        +- resolve project  plan.project_id                      -> 400 if null
        +- resolve Taiga integration (body.integrationId -> project provider:'taiga')
        |   -> 400 "Connect Taiga for this project first"
        +- build client (token, else username+password auth, else env fallback)
        +- resolve Taiga project: GET /projects/{id}   -->  by_slug fallback
        +- load metadata in parallel:
        |     memberships, userstory-statuses, task-statuses, milestones,
        |     priorities, points   (Promise.all — independent)
        +- build maps: user(role->id), storyStatus(slug->id), taskStatus(slug->id),
        |     milestone(external_id->taiga_id) from taiga_mappings
        +- load mappings (taiga_mappings, plan_id)
        +- DRY RUN -> return diff, STORAGE UNCHANGED
        +- for each sprint:            (strict dependency order)
             1. milestone  create | PATCH
             2. user story create | PATCH   -> capture taiga_id
             3. tasks      create | PATCH   (user_story = story taiga_id,
                                             milestone = milestone taiga_id)
           -> upsert taiga_mappings + sync_status
           -> write taiga_sync_runs record
           -> plan: status 'published', published_at, publish_status, taiga_project_id
           -> best-effort: refreshProjectData(projectId) + rebuildProjectContext(projectId,'taiga_sync')
```

Metadata requests (the parallel block) must be `Promise.all`; entity creation must stay
sequential per level (Milestone -> User Story -> Task) because children need parent ids.
The existing `BATCH_SIZE = 20` applies *within* a level only.

## 6. Service and repository changes

### `src/domain/integration/service/taiga_client.ts`
- `getProject(id)` -> `GET /projects/{id}`; keep `projectBySlug` as fallback.
- `getUserStoryStatuses(projectId)` -> `GET /userstory-statuses?project=`.
- `getMetadata()` (:92-119) — add `userstoryStatuses`; keep `taskStatuses`, `priorities`,
  `points`, `taskTypes`, `severities`, `users` (from `memberships`).
- `listMilestones(projectId)`, `listUserStories(projectId, milestone?)`,
  `listTasks(projectId, { milestone?, user_story? })` for reconciliation.
- `createUserStory` (:132-134) / `createTask` (:142-144) already spread `body`, so passing
  `milestone`, `user_story`, `status`, `us_order`, `taskboard_order` needs no client change —
  just make sure the service sends them.
- Add a per-request timeout (`AbortController`) and **token-masked** error strings.

### `src/domain/integration/service/taiga_publish_service.ts`
- `resolveSyncContext(planId, opts)` -> `{ plan, projectId, integ, client, taigaProject }`.
- `startSyncRun()` / `finishSyncRun()` -> `taiga_sync_runs`.
- `runPlanSync({ planId, mode, dryRun, allowUnassigned })` — the algorithm in section 5.
- `getSyncStatus(planId)`, `retryFailed(planId)` (re-process only `sync_status != 'success'`).
- Keep `publishPlan` (:25), `createInTaiga` (:74), `previewPlan` (:145), `testConnection`
  (:182), `getStatus` (:194), but make them delegate to the new entry point so behaviour stays
  single-sourced.
- Status gate: accept `accepted | approved | published` (`PLAN_NOT_ACCEPTED` otherwise).
- Story status resolution: `userstory-statuses` -> first non-closed; apply slug -> id.
- Story points: sprint `planned_points` -> nearest `points` metadata `value` (skip silently if
  none). **Never send `points` on a Task** (remove it from the payload at :310).
- `publishMilestones` (:224) is no longer part of the plan push — the sprint-level mapping makes
  the sprint itself the milestone. Keep the method for the standalone/project-level flow, but
  do not call it from `runPlanSync`.
- `publishSprints` (:245) / `publishUserStories` (:266) / `publishTasks` (:289) collapse into
  one per-sprint walk so the story id is available when the tasks are created.

### Controller / routes / middleware
- `taiga_controller.ts` — add `createInTaigaForPlan`, `previewForPlan`, `getPlanSyncStatus`,
  `retryPlanSync`; parse `:planId` from `req.params` and resolve `projectId` from the plan.
- **New** `src/domain/integration/route/taiga_plan_route.ts` — factory `createTaigaPlanRoutes()`
  returning a `Router({ mergeParams: true })`; mount from `app_routing.ts` (`planRoutes`) **and**
  from `ai_intelligence_route.ts` so `/v1/plans/*` and `/v1/ai/plans/*` stay in parity.
- Delete the dead `src/domain/integration/route/taiga_route.ts`, or mount it from
  `project_route.ts` and remove the inline duplicates there (`project_route.ts:66-73`). Pick one;
  never double-register.
- `ai_intelligence_middleware.ts` — add `validateTaigaSync` (`mode` enum, `dry_run` boolean,
  valid `planId`).

## 7. Data model changes

### `taiga_mappings` (extend `models/taiga_mapping_model.ts`, currently :14-24)
```ts
{
  project_id, plan_id, entity_type: 'milestone'|'sprint'|'user_story'|'task',
  external_id,                       // sprint-N | story_sprint-N | sprint-N-task-M
  taiga_id, taiga_ref, name,
  taiga_project_id?: number,
  taiga_milestone_id?: number,       // parent context for user_story / task
  taiga_user_story_id?: number,      // parent context for task
  sync_status: 'pending'|'processing'|'success'|'failed'|'skipped',
  last_error?: string | null,
  last_synced_at, created_at, updated_at
}
```
Index: unique `{ plan_id: 1, entity_type: 1, external_id: 1 }` (extends the existing idempotency
index). Note: `Model.updateAnyRecord` is `updateMany` by design — always filter by `_id`.

### `taiga_sync_runs` (**new** `models/taiga_sync_run_model.ts`)
```ts
{ sync_id, plan_id, project_id, integration_id, mode, dry_run,
  status: 'processing'|'completed'|'partial'|'failed',
  counts: { milestones: {...}, user_stories: {...}, tasks: {...} },
  errors: Array<{ source_id, entity_type, field?, error }>,
  warnings: Array<{ source_id, type, value? }>,
  taiga_project_id, started_at, finished_at, created_at, updated_at }
```
Serves `GET /v1/plans/:planId/taiga-sync`.

## 8. Status and assignee resolution

```ts
const normalize = (v: string) =>
  String(v).trim().toLowerCase().replace(/\s+/g, '-');
```
- User Story status <- `userstory-statuses`; Task status <- `task-statuses`. Never hard-code ids;
  never silently pick an arbitrary status when a semantic value is present but unresolved —
  return `{ source_id, field: 'status', value, error: 'Taiga <kind> status not found' }`.
- Sprint-level stories carry no semantic status, so apply the project's first **non-closed**
  `userstory-statuses` entry (same rule `publishTasks` already uses for tasks at :293).
- Assignee: `task.assignee_role` -> `taiga_user_mappings.taiga_user_id`.
  - strict (default, `allow_unassigned: false`): error
    `ASSIGNEE_MAPPING_MISSING: No Taiga user mapped to role '<role>'.` (existing behaviour :308)
  - safe (`allow_unassigned: true`): create unassigned, push a `USER_ROLE_UNMAPPED` warning.
- Never send a username in `assigned_to`; Taiga expects the numeric user id.

## 9. Idempotency, partial failure, retry

```
mapping exists for (plan_id, entity_type, external_id)?
        |
    yes | no
        |  +- create -> save mapping (sync_status: success)
        +- mode === 'sync'   -> PATCH -> update last_synced_at
           mode === 'create' -> ALREADY_EXISTS, nothing else runs
```
- `create` is all-or-nothing by pre-flight: collect **all** existing mappings first (as
  `createInTaiga` does today, :92-117), then fail with a single message listing them.
- `partial`: per-entity `sync_status: failed` + `last_error` are persisted; the run record and
  the response summarise them; **nothing is deleted**.
- `retry`: re-runs only rows whose `sync_status` is `pending`/`failed`/`skipped`, and only the
  parents needed for those rows (a failed task needs its milestone/user-story mapping to exist,
  which it will after a partial run).
- `dry_run` must not write to `taiga_mappings` or create a `taiga_sync_runs` row either (or mark
  it `dry_run: true` and keep `counts` separate) — assert this with the verification script.

## 10. Security and configuration

- Credentials only in the integration document (token, or username/password -> `POST /auth`
  -> token cached back on the doc, already implemented at `taiga_publish_service.ts:207-211`) or
  in `.env` (`TAIGA_API_BASE`, `TAIGA_AUTH_TOKEN`, `TAIGA_USERNAME`, `TAIGA_PASSWORD`).
- The env path is used only when `taiga_project_id` + `base_url` are supplied in the body
  (a project with no integration document). Otherwise:
  `400 Connect Taiga for this project first.`
- Never return the token in a response, never log it, never write it into `ai_plans`.
  Log `Taiga request failed: 403 Forbidden`, not the header.
- Correlation id per run: `TAIGA-SYNC-<yyyymmdd>-<seq>`; log start, each created entity
  (`source=... taiga=...`) and the completion summary.

## 11. Errors

| Case | HTTP / result | Message |
| --- | --- | --- |
| Not logged in | 401 | envelope handled by client |
| No project access | 403 | `Project access required to sync.` |
| Plan missing | 400 | `Plan not found.` |
| Plan is `draft` | 400 | `PLAN_NOT_ACCEPTED: accept the plan before publishing to Taiga.` |
| Plan has no project | 400 | `Plan has no project. Generate the plan for a project to publish it to Taiga.` |
| No Taiga integration | 400 | `Connect Taiga for this project first.` |
| Taiga project unreachable | 400 | `Taiga project not found or not accessible.` |
| Duplicate in `create` mode | 400 | `ALREADY_EXISTS: milestone 'sprint-1', task 'sprint-1-task-2' ... Delete them or run mode: sync.` |
| Unmapped role, strict | 400, run `failed` | `ASSIGNEE_MAPPING_MISSING: No Taiga user mapped to role 'qa'.` |
| Unknown status | 400, run `failed` | `{ source_id, field: 'status', value, error: 'Taiga task status not found' }` |
| Taiga 401/403 | 400, run `failed` | refresh token / report permission problem, stop the run |
| Taiga 400 | per-entity failure | store Taiga's `_error_message` on the mapping and in `errors[]` |
| Taiga 429/5xx | retry with exponential backoff | only for idempotent calls (GET/PATCH); never blind-retry `POST` |
| Partial | HTTP 200 | `status: 'partial'` + per-entity errors, offer retry |

## 12. After a successful publish

1. `ai_plans`: `status: 'published'`, `published_at`, `publish_status`, `taiga_project_id`.
2. `integrations`: `sync_status`, `last_sync_at` (so the Taiga card and `GET /taiga/status`
   at :194-202 reflect it).
3. `refreshProjectData(projectId)` (`integration_service/project_data_refresh.ts`) and
   `rebuildProjectContext(projectId, 'taiga_sync')` so the new milestone/story/task rows show in
   the app's sprints/work-items/departments views and in AI context — best-effort, a failure here
   must not fail the publish.
4. Optionally let the user run the existing read-side sync (`POST /v1/projects/:id/sync`) for the
   full Taiga mirror (task statuses, stats, `taiga_tasks`).

## 13. Tests and verification

- `npm run typecheck` (must stay at exit 0 — it currently passes).
- **New** `src/scripts/verify_taiga_publish.ts` (same shape as the existing `verify_*.ts` scripts):
  1. connect + `preview` -> assert `taiga_mappings` count unchanged (dry-run writes nothing);
  2. `create` against a scratch Taiga project -> assert one mapping per milestone/story/task and
     that each created task has `user_story` set;
  3. run again with `mode: 'sync'` -> assert `created === 0`, `updated === N`, `failed === 0`
     and that the Taiga object counts did not grow (idempotency);
  4. force one task to fail (bad role, strict) -> assert `partial`, the mapping is `failed`,
     then `retry` fixes it.
- Manual curls for the 4 endpoints, including the 400/403 branches in section 11.
- Unit-check the mappers: status normalizer, role map, milestone/story/task payload builders,
  existing-mapping detection.

## 14. Implementation order

> **Status:** Phase 0 is implemented (routes mounted, status gate, project resolution,
> sprint-level mapping with linked tasks, `preview`/create response envelope, sync-status
> endpoint). Phases 1-4 remain.

| Phase | Deliverable |
| --- | --- |
| 0 | Mount/fix routes, status gate (`accepted\|published`), project resolution split (`repository_name` = Taiga project id, `repository_url` = API base), one milestone + one user story per sprint, `user_story` + `milestone` on created tasks, stop pushing `plan.milestones[]` — **done** |
| 1 | `taiga_sync_runs` run history (`sync_id`, per-run `counts`/`errors`/`warnings`) so `GET .../taiga-sync` can return the latest run rather than deriving it from `taiga_mappings`; persist unmapped-role warnings on the create response |
| 2 | `retry` narrowed to rows whose `sync_status` is not `success` (today it re-runs the plan in `sync` mode) |
| 3 | Local mirror refresh + context rebuild, docs, `verify_taiga_publish` script (live Taiga) |
| 4 | Optimisation: `bulk_create`, metadata caching, background queue for very large plans, optional **one User Story per feature** (AI plan emits `features[]`); the sprint-level path is retained as the default/fallback |

## 15. Acceptance criteria (backend)

- `POST /v1/plans/:planId/create-in-taiga` returns 200 and creates Milestone -> User Story ->
  Task in that order, with tasks linked to their story (`user_story`) and milestone (`milestone`).
- For each sprint the run creates exactly **one** User Story, and every task of that sprint is
  linked to it (visible under the story in Taiga).
- `plan.milestones[]` is not pushed, so no sprint appears twice in Taiga.
- Running it twice in `sync` mode creates nothing new (no duplicate milestones/stories/tasks).
- `dry_run: true` returns the same diff with **zero** writes to Taiga or to `taiga_mappings`.
- A partial run persists per-entity state, marks the plan `published` with
  `publish_status: 'partial'`, and `retry` completes the remainder.
- No Taiga token appears in any response, log line, or stored plan document.
- `npm run typecheck` passes.

## 16. Assumptions and open items

- Response shapes in this document are contract-level; validate `userstory-statuses`,
  `task-statuses` and whether Taiga accepts `points` on tasks against your Taiga
  version/instance before production.
- Story granularity is **sprint-level** (locked): 1 User Story per sprint. Feature-level
  (`features[]` per sprint) is the documented Phase-4 extension in section 3.
- Self-hosted Taiga: `base_url` must be the API root (`https://<host>/api/v1`), stored in the
  integration's `repository_url`; the Taiga **project** id goes in `repository_name`.
