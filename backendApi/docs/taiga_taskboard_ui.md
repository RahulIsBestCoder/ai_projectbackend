# Taiga taskboard section: UI instructions

For: the frontend developer on the board with the **USER STORY** lane and the
`NEW / IN PROGRESS / READY FOR TEST / CLOSED / NEEDS INFO` columns.

Scope: how to feed that section from the Taiga sync data, and how to show the AI
task plan on top of it. Everything below was verified against the live DB
(`ai_project`) on 2026-09-22 — counts and ids are real, not examples.

---

## 0. What that screenshot is actually rendering

The 9 cards are the **9 `work_items` rows** of project `6aae8b5324b246439e32fa69`
(the published test project). The `#eae6` style prefix is the last 4 hex chars of
the Mongo `_id`:

| Card in screenshot | `work_items._id` | `external_id` | `type` | `title` | `status` |
|---|---|---|---|---|---|
| `#eadd login is not working` | `…e3eadd` | `taiga-issue-2372416` | bug | login is not working | in_progress |
| `#eae6 Sprint 7` | `…e3eae6` | `taiga-us-9558932` | story | Sprint 7 | in_progress |
| `#eae7 Sprint 5` | `…e3eae7` | `taiga-us-9558933` | story | Sprint 5 | in_progress |
| `#eae8 Sprint 6` | `…e3eae8` | `taiga-us-9558934` | story | Sprint 6 | in_progress |
| `#eae9 Sprint 2` | `…e3eae9` | `taiga-us-9558936` | story | Sprint 2 | in_progress |
| `#eaea Sprint 8` | `…e3eaea` | `taiga-us-9558938` | story | Sprint 8 | in_progress |
| `#eaeb Sprint 1` | `…e3eaeb` | `taiga-us-9558941` | story | Sprint 1 | in_progress |
| `#eaec Sprint 4` | `…e3eaec` | `taiga-us-9558942` | story | Sprint 4 | in_progress |
| `#eaed Sprint 3` | `…e3eaed` | `taiga-us-9558944` | story | Sprint 3 | in_progress |

Three consequences visible in the UI today:

1. **The board is showing stories and issues, not tasks.** The real tasks of that
   sprint live in `taiga_tasks` (42 rows for this project) and are not rendered at all.
2. **Only one column can ever fill.** `work_items.status` is the internal enum
   (`todo | in_progress | blocked | done`); all 9 rows are `in_progress`, so they all
   land in IN PROGRESS and the other four columns stay empty. The Taiga column names
   in the header do not correspond to any field of `work_items`.
3. **`#1 Sprint 1` is a user story, not a lane label.** `title: "Sprint 1"` comes
   from the publish step, which names each sprint's single story after the sprint
   (see `docs/taiga_plan_publish_ui.md`). The story is the lane; it must not also be a card.

### The fix in one paragraph

Columns come from Taiga **task statuses**; lanes come from the **user story** each
task belongs to; cards are **`taiga_tasks`** documents. `work_items` stays what it
is (stories + issues) and should no longer supply the cards of this board.

---

## 1. Which collection holds what

| Collection | Holds | Written by |
|---|---|---|
| `taiga_task_statuses` | The 5 column definitions per Taiga project: `taiga_status_id, name, is_closed, sort_order` | `integration_service.ts:1206-1225` |
| `taiga_tasks` | One row per Taiga task: `ref, subject, status, status_name, status_color, is_closed, is_blocked, user_story_id, user_story_ref, user_story_subject, taiga_milestone_id, assigned_to_*, us_order, taskboard_order, tags, attachments_count, total_comments, synced_at` | `TaigaTaskModel.buildSyncOps` → `:1075` |
| `sprint_summaries` | Per-sprint `status_summary` counts + `total_tasks/completed_tasks` | `:1336-1358` |
| `sprints` | Sprint ↔ milestone link (`taiga_milestone_id`), dates, points | `:1227-1249` |
| `work_items` | Taiga **user stories** (`taiga-us-*`) and **issues** (`taiga-issue-*`) | `:1251-1280`, `:1036` |
| `tasks` | A normalized copy of the same Taiga tasks (`external_id: taiga-task-*`) | `:1302-1330` |
| `taiga_mappings` | Plan → Taiga id map (**publish only**, not sync) | `taiga_publish_service.ts` |

Live numbers, demo project `6aa3dcab151ea1909a177bd9`: `taiga_tasks` 59,
`taiga_task_statuses` 5, `sprint_summaries` 1, `sprints` 1, `work_items` 3,
`tasks` 59, `taiga_mappings` **0**.

---

## 2. Endpoints

```http
GET  /v1/projects/:projectId/integrations           -> find provider === 'taiga' -> integration._id
GET  /v1/integrations/:integrationId/taiga-tasks    -> cards + column roll-up (see below)
GET  /v1/projects/:projectId/sprints                -> lane dates / names
GET  /v1/sprints/:sprintId/taga-status-tabs         -> sprint-scoped tabs (note the typo in the path)
POST /v1/projects/:projectId/sync                   -> refresh the mirror
```

### 2.1 `GET /v1/integrations/:integrationId/taiga-tasks`

Query params (`integration_controller.ts:150-171`): `milestone`, `user_story`,
`assigned_to`, `status` (Taiga status id), `is_closed` (`true|false`), `search`,
`page` (default 1), `limit` (default 100).

`response.dataset` — every payload below is the `dataset` object inside the response
envelope `{ response: { dataset, status: { msg, action_status } } }` (`common_helper.ts:55`):

```json
{
  "rows": [ { "_id": "...", "ref": 4,
              "subject": "Login -Invalid phone number is accepting ...",
              "status": 8982800, "status_name": "Closed", "status_color": "#A8E440",
              "is_closed": true, "is_blocked": false,
              "user_story_id": 9451872, "user_story_ref": 2, "user_story_subject": "Web",
              "taiga_milestone_id": 527671,
              "assigned_to_id": 123456, "assigned_to_full_name": "Soumen Mahato",
              "taskboard_order": 1785752961801, "us_order": 1785752961797,
              "attachments_count": 1, "tags": [], "due_date": null,
              "synced_at": "2026-09-21T18:56:34.000Z" } ],
  "count": 59, "page": 1, "limit": 100, "total": 59, "total_pages": 1,
  "project_id": "...", "taiga_project_id": 6671234,
  "taiga_project_slug": "msspl-mgroc", "last_synced_at": "...",
  "roll_up": {
    "total_tasks": 59, "closed_tasks": 10, "open_tasks": 49,
    "statuses": [ { "status": 8982797, "name": "New", "color": "#70728F", "is_closed": false, "count": 28 } ]
  }
}
```

`roll_up.statuses` is sorted by count desc. Use it for the chips/counters; use
`taiga_task_statuses.sort_order` for the **column order**.

> **Blocker:** this endpoint currently returns **0 rows** for both projects.
> See §7.1 — it must be fixed before the UI can be wired to it.

---

## 2.2 The rest of the calls

```http
GET /v1/projects/:projectId/integrations
```
`dataset.rows[]` — pick `provider === 'taiga'` → its `_id` is the `integrationId` for §2.1.
No taiga row → render the section's "Connect Taiga" empty state
(`POST /v1/projects/:projectId/taiga/connect` creates one).

```http
GET /v1/projects/:projectId/sprints
```
`{ rows, count, active_sprint }` (`sprint_intelligence_service.ts:105-127`). Taiga-synced
sprints carry `taiga_milestone_id`, `start_date/end_date`, `status` and points —
`taiga_milestone_id` is the value for §2.1's `milestone` param; `active_sprint` is the
default dropdown selection.

```http
GET /v1/sprints/:sprintId/taga-status-tabs        <- the 'taga' typo is the real path
```
`{ sprint: { _id, name, status, start_date, end_date, taiga_milestone_id },
   status_tabs: [ { name, count, status_id, is_backlog?, color } ] }`
(`sprint_intelligence_service.ts:258-347`). This is the only endpoint that returns the
statuses in Taiga's **canonical order** — see §3.1.

```http
POST /v1/projects/:projectId/sync                 (auth)
```
Refreshes everything in §1. Takes 30-60 s; a per-project lock + AI-sync cooldown answers
409/429 while a sync is running or just ran — surface `response.status.msg`, keep the board
interactive, and refetch §2.1 after success. `dataset.items_synced` reports what was written
(under-reports the task mirror today — §7.3).

---

## 3. Columns, lanes, cards

```ts
interface TaigaTaskCard {          // one rows[] item of §2.1
  _id: string;
  ref: number;                     // the "#23" chip
  subject: string;                 // card title
  status: number;                  // Taiga status id -> column
  status_name: string; status_color: string;
  is_closed: boolean; is_blocked: boolean;
  user_story_id?: number; user_story_ref?: number; user_story_subject?: string;  // lane
  taiga_milestone_id?: number;     // sprint filter
  assigned_to_id?: number | null; assigned_to_full_name?: string | null;
  due_date?: string | null; finished_date?: string | null;
  us_order?: number; taskboard_order?: number;   // sort within a lane
  attachments_count?: number; total_comments?: number; tags?: string[];
}
```

Group, in order:

1. **Columns** = `roll_up.statuses`, deduped by `status`.
2. **Lanes** inside a column = group by `user_story_id` (null → "No story" lane last).
   Lane header: `#<user_story_ref> <user_story_subject>`. Lane order: smallest `us_order`
   among its tasks.
3. **Cards** in a lane: `taskboard_order`, then `us_order`, then `ref` — the server already
   returns rows in this order; keep it stable instead of re-sorting.

Card content: ref chip, 2-line-clamped `subject`, status dot in `status_color`, assignee
initials from `assigned_to_full_name`, meta row (`total_comments`, `attachments_count`,
`tags`). `is_blocked` → red border + `blocked_note` tooltip. Overdue `due_date`
(not `is_closed`) → red date.

### 3.1 Column order caveat

`roll_up.statuses` only contains statuses that occur on tasks and is sorted by count desc.
For Taiga's real column order use `status_tabs` from §2.2 (it reads
`taiga_task_statuses.sort_order`), or take §7.2 (backend adds the ordered list to §2.1).
Do **not** hardcode "New / In progress / Ready for test / Closed / Needs Info" — statuses
are per-Taiga-project data.

---

## 4. Wiring the section

State: `{ integrationId, rows, rollUp, filters: { milestone, user_story, assigned_to,
status, is_closed, search }, page }`.

1. **Mount** — call §2.2 integrations; no Taiga row → connect empty state, stop.
2. **Load** — `GET …/taiga-tasks?limit=100` with the current filters. Render the chips from
   `roll_up` immediately, then columns/lanes/cards from `rows`. While §7.1 is unfixed this
   returns `count: 0` — show the "No tasks synced yet" empty state, not an error.
3. **"Whole Task Plan" dropdown** — options from §2.2 sprints (`name`), plus "All sprints".
   Selection → `milestone=<taiga_milestone_id>`; "All" → omit the param. (Despite the name,
   this control filters the Taiga mirror; the AI plan itself lives in §5.)
4. **Status chips** — "All" → omit `status`; a chip → `status=<id>`; open/closed quick
   toggles → `is_closed=false|true`. Chip counts come from `roll_up.statuses`, which is
   computed without the filters, so chips stay stable while filtering.
5. **Search box** ("Search by Task ID") — debounce 300 ms → `search=<text>` (server-side,
   regex-escaped). When the input is all digits also filter `rows` by `ref` client-side for
   instant feedback.
6. **Refresh** — button → `POST /v1/projects/:projectId/sync`, disabled while in flight,
   then re-run step 2. Show `last_synced_at` as "Synced 4m ago". On 409/429 toast
   `response.status.msg`.
7. **Load more** — `page+1` while `page < total_pages`.

---

## 5. How to show the task plan

Two layers, overlaid: the **plan** (what the AI proposed — `ai_plans` + its execution
checklist) and the **mirror** (what Taiga actually has — `taiga_tasks`). The header row of
the section ("Whole Task Plan …") is the natural place for both.

### 5.1 Plan endpoints (all working today)

```http
GET  /v1/plans?project_id=:projectId              -> rows[] of ai_plans docs
GET  /v1/plans/:planId                            -> one doc incl. the full plan.plan
GET  /v1/plans/:planId/execution                  -> render-ready checklist tree (use this)
PATCH /v1/plans/:planId/execution/:kind/:itemId   body { "is_completed": boolean }
GET  /v1/plans/:planId/taiga-sync                 -> publish state + mapping summary
```

Pick the plan: `status === 'published'` first, else `'accepted'`, else the newest row.

### 5.2 `execution` is render-ready — don't re-walk `plan.plan`

```json
{ "plan": { "_id": "…", "title": "Sprint Plan - Mgroc demo 1", "status": "accepted",
            "accepted_at": "2026-09-13", "project_id": "6aa3dcab151ea1909a177bd9" },
  "progress": { "by_kind": { "sprint": { "total": 17 }, "task": { "total": 51 },
                             "dependency": { "total": 16 }, "milestone": { "total": 4 },
                             "deadline": { "total": 21 } },
                "total": 109, "completed": …, "percent": … },
  "sprints": [ { "_id": "…", "ref_key": "sprint-1", "title": "Sprint 1",
      "meta": { "goal": "Implement 2 features for Mgroc demo 1",
                "start_date": "2026-09-13", "end_date": "2026-09-26",
                "deadline": "2026-09-26", "planned_points": 32 },
      "is_completed": true,
      "tasks": [ { "_id": "…", "ref_key": "sprint-1-task-1", "parent_key": "sprint-1",
                   "title": "P3 — Admin Panel, Staff & Reporting", "sequence": 1,
                   "meta": { "type": "task", "priority": "high", "assignee_role": "qa",
                             "estimate_hours": 8, "story_points": 5 },
                   "is_completed": true } ],
      "dependencies": [ … ] } ],
  "milestones": [ … ], "deadlines": [ … ] }
```

`completed`/`percent` follow the checklist ticks (`is_completed`). Tick a row with the
PATCH (`:itemId` = the execution item's `_id`; the response returns fresh `progress` —
update state from it, no refetch).

### 5.3 The dropdown can be the plan's sprints

Options = `execution.sprints` ("Sprint 1" … "Sprint 17"); "All" = the whole plan with
`progress.percent` as the header progress. Selecting Sprint N filters **both layers**:
plan tasks with `parent_key === "sprint-N"`, and board tasks with
`milestone=<that sprint's taiga_milestone_id>` (from §2.2 sprints).

### 5.4 Overlay: plan task ↔ Taiga task

`GET /v1/plans/:planId/taiga-sync` →
`{ plan_published, status, published_at, taiga_project_id, last_sync_at,
   summary: { milestones, user_stories, tasks }, failed_count, failed[] }`
(`taiga_publish_service.ts:267-301`). The per-entity id pairs live in `taiga_mappings`
(written only by publish): `{ external_id: "sprint-N-task-M", taiga_id, taiga_ref, name,
taiga_milestone_id, taiga_user_story_id, sync_status: "pending|processing|success|failed|skipped",
last_error }`.

Join `execution.sprints[].tasks[].ref_key === mapping.external_id`:

| mapping state | chip on the plan-task row |
|---|---|
| `sync_status: "success"` | green "In Taiga #<taiga_ref>" → link `https://tree.taiga.io/project/<slug>/task/<taiga_id>` |
| anything else | grey "Planned — not in Taiga" |

Live state (2026-09-22): the taigatests plan `6aae8c00…fa95` has **42/42** task mappings →
full overlay; the accepted Mgroc demo 1 plan ("Sprint Plan - Mgroc demo 1") has **0** → all
51 rows show "Planned" and the panel shows the **Create in Taiga** button.

### 5.5 Publish actions

`POST /v1/plans/:planId/create-in-taiga` body `{ "mode": "sync", "dry_run": false,
"allow_unassigned": true }`; confirm modal → `…/create-in-taiga/preview`; failures →
`…/taiga-sync/retry`. The full button/modal/mapping UX is already specified in
`docs/taiga_plan_publish_ui.md` — follow it there; this doc covers only the overlay.

Auth note: the `/v1/plans` root alias currently has no `validateToken`
(`app_routing.ts:48-54`); don't build UI logic that depends on 401 behaviour of these routes.

---

## 6. Do not build on these

- **`tasks` collection** — the sync writes a normalized copy (`integration_service.ts:1361`)
  but **no endpoint reads it**. Ignore it.
- **`work_items` for tasks** — the Taiga sync stores only user stories (`taiga-us-*`) and
  bugs (`taiga-issue-*`) there. It cannot feed a task board.
- **`sprint_summaries`** — sprint-scoped roll-ups, reachable only through
  `taga-status-tabs`; there is no direct endpoint.

---

## 7. Backend fixes, in order

### 7.1 BLOCKER — the board's endpoint returns 0 rows

`TaigaTaskModel.buildSyncOps` puts `$setOnInsert` **outside** `update`
(`src/domain/integration/models/taiga_task_model.ts:79-92`), the MongoDB driver silently
drops it, so no synced row ever gets `is_deleted`/`created_at` — and the reader filters
`is_deleted: false` (`integration_service.ts:434,456,478`), matching nothing. Measured:
59 + 42 rows exist, `is_deleted: false` matches 0.

```ts
// taiga_task_model.ts — move $setOnInsert INSIDE update (same shape as taiga_issues:1029)
update: {
  $set: { ...item, external_id: `taiga-task-${item.taiga_task_id}`,
          updated_at: new Date(), synced_at: new Date() },
  $setOnInsert: { is_deleted: false, created_at: new Date() },
},
```

One-time data repair (mongo shell):

```js
db.taiga_tasks.deleteMany({ taiga_task_id: { $exists: false } });        // 10 legacy seed rows
db.taiga_tasks.updateMany({ is_deleted: { $exists: false } },
                          { $set: { is_deleted: false } });
db.taiga_tasks.updateMany({ created_at: { $exists: false } },
                          [ { $set: { created_at: "$synced_at" } } ]);   // pipeline update
db.taiga_tasks.createIndex({ project_id: 1, integration_id: 1, taiga_task_id: 1 },
  { unique: true, partialFilterExpression: { taiga_task_id: { $exists: true } } });
```

Also make the in-code index creation partial the same way
(`integration_service.ts:973-975`; the pattern already exists for `taiga_issues` at `:985`) —
otherwise every sync keeps failing with E11000 on the null-key seed rows.

Verify:

```bash
curl "…/v1/integrations/<taigaIntegrationId>/taiga-tasks?limit=5"
# dataset.count must be 59 (project 6aa3dcab…) / 42 (project 6aae8b53…)
```

### 7.2 Column order in one call
Add the ordered `taiga_task_statuses` list to the taiga-tasks dataset so the UI needs no
second request for column order (§3.1).

### 7.3 Honest `items_synced`
`integration_service.ts:1371-1379` reports `work_items/sprints/tasks/sprint_summaries/
task_statuses/issues` but not the `taiga_tasks` mirror as its own entry — add `taiga_tasks`
(and `taiga_issues`) so the sync toast reports the collections the board actually reads.

### 7.4 Not needed for this UI
A real `taiga_sync_runs` history is phase 1 of `taiga_plan_publish_backend.md`;
`GET …/taiga-sync` already answers from `ai_plans` + `taiga_mappings`.

---

## 8. Acceptance checklist

- [ ] Project without a Taiga integration → connect empty state; no board call fires.
- [ ] Mgroc demo 1 (after §7.1): 59 cards, columns in Taiga order, story lanes ("Web", …).
- [ ] "Whole Task Plan" = Sprint 1 → `milestone=527671`; "All" → no param; card counts match chips.
- [ ] Status chip / All / open-closed toggles filter without changing chip counts.
- [ ] Search accepts text ("otp") and a bare ref number.
- [ ] Refresh updates `last_synced_at`; an immediate second click shows the cooldown message.
- [ ] Plan panel: 17 sprints / 51 tasks / 109 checklist rows; `progress.percent` in the header.
- [ ] taigatests plan: rows show "In Taiga #ref" deep links; Mgroc plan: "Planned — not in
      Taiga" plus a working Create in Taiga.
- [ ] Checkbox tick PATCHes and updates `progress` without a refetch.
