# Taiga task board + task plan: UI integration & user-flow plan

For: the frontend team wiring the **Tasks / Taskboard section** and the **Task Plan panel**
into the project screens. This is the *build plan* — field-level contracts live in
[`docs/taiga_taskboard_ui.md`](./taiga_taskboard_ui.md) (§ references below point there),
and the publish-button UX already specified in
[`docs/taiga_plan_publish_ui.md`](./taiga_plan_publish_ui.md) is reused, not redefined.

All numbers/ids below are from the live DB audit of 2026-09-22 (Mgroc demo 1
`6aa3dcab151ea1909a177bd9`, taigatests `6aae8b5324b246439e32fa69`).

---

## 1. Deliverables

| # | Deliverable | Screen region |
|---|---|---|
| D1 | Task board (columns × story lanes × task cards) fed by `taiga_tasks` | Project → Tasks tab, main grid |
| D2 | Toolbar: "Whole Task Plan" (sprint) dropdown, status chips + All, open/closed toggle, search, Refresh + "Last synced…" | Above the grid |
| D3 | Task Plan panel: accepted plan's sprints → tasks, checklist ticks, progress | Right rail / tab beside the board |
| D4 | Plan↔board overlay: "In Taiga #ref" chips + deep links, Create-in-Taiga / Retry actions | Plan panel rows |

Out of scope: editing tasks (read-only mirror), drag-and-drop column moves (Taiga is the
source of truth; write-back would need new backend endpoints), and the AI plan generator
screen itself.

## 2. Build order & gate

```
B1 (BLOCKER)  §7.1 backend fix + one-time data repair  → board data exists
P1  API client + types + envelope unwrap               → nothing renders without it
P2  Board MVP (D1)                                     → demoable board
P3  Toolbar + filters (D2)                             → usable board
P4  Task Plan panel + overlay (D3, D4 read-only)       → "task plan" visible
P5  Refresh + publish actions (D4 actions)             → closed loop
P6  Polish: cache, optimistic ticks, a11y, telemetry
```

**Gate rule:** P2+ may start before B1 lands using a **plan-only fallback** (see Flow E),
but the board grid must not ship to users while `GET …/taiga-tasks` returns 0 rows for the
two known projects — that is the B1 regression test.

## 3. Phase detail

### P0 — Backend (half a day, blocks the board)

1. §7.1: move `$setOnInsert` inside `update` in `TaigaTaskModel.buildSyncOps`; run the
   repair script (delete 10 null-key seed rows, backfill `is_deleted`/`created_at`,
   create the partial unique index); make `ensureTaigaTaskIndexes` partial.
2. §7.2 (small, recommended): append ordered `statuses[]` (from `taiga_task_statuses`) to
   the taiga-tasks dataset so the UI needs one request, not two.
3. §7.3 (cosmetic): add `taiga_tasks` to `items_synced`.
4. Verify: `curl "…/v1/integrations/<id>/taiga-tasks?limit=5"` → `dataset.count` 59 / 42.

### P1 — API client (`lib/api/taigaBoard.ts` + types)

Envelope: every response is `{ response: { dataset, status: { msg, action_status }, publish } }`
(`common_helper.ts:55`); success = `action_status === true`, errors are HTTP 400 + `status.msg`.
One `unwrap()` helper; never read `dataset` without it.

```ts
getProjectIntegrations(projectId)                       // GET /v1/projects/:id/integrations
getTaigaTasks(integrationId, q?: BoardQuery)            // GET /v1/integrations/:id/taiga-tasks   (§2.1)
getSprints(projectId)                                   // GET /v1/projects/:id/sprints          (§2.2)
getStatusTabs(sprintId)                                 // GET /v1/sprints/:id/taga-status-tabs  (typo path is real)
syncProject(projectId)                                  // POST /v1/projects/:id/sync   (auth; 409/429 cooldown)
listPlans(projectId) / getPlanExecution(planId)         // GET /v1/plans?project_id=, GET /v1/plans/:id/execution
toggleExecutionItem(planId, kind, itemId)               // PATCH /v1/plans/:id/execution/:kind/:itemId
getPlanTaigaSync(planId)                                // GET /v1/plans/:planId/taiga-sync      (§5.4)
createInTaiga(planId, body) / preview / retry           // POST …  (auth) — docs/taiga_plan_publish_ui.md
```

Types: `TaigaTaskCard`, `StatusTab`, `SprintRow`, `PlanExecution` (all in §2–§5 of the
contracts doc). Auth note: `GET taiga-tasks` and the root `/v1/plans` alias carry **no**
`validateToken` today — send the session header anyway; don't build logic on their 401s.

**Done when:** typed functions + `unwrap` + one retry-with-backoff on network error; unit
test each unwrapper against recorded payloads.

### P2 — Board MVP (D1)

Components: `TaskBoardSection` (container, owns fetching) → `BoardGrid` → `Column` →
`StoryLane` → `TaskCard`. Transform per contracts §3: columns from `status_tabs`
(canonical order; `roll_up.statuses` only for counts), lanes by `user_story_id`
(null → "No story" lane last, header `#<ref> <subject>`), card order = server order
(`taskboard_order, us_order, ref` — do **not** re-sort). Card per §3: ref chip, 2-line
subject, status dot in `status_color`, assignee initials, comments/attachments/tags meta,
`is_blocked` red border + `blocked_note` tooltip, overdue `due_date` in red.

**Done when:** Mgroc demo 1 renders 59 cards in 5 Taiga-ordered columns with story lanes
("Web", …); taigatests renders 42.

### P3 — Toolbar (D2)

State → query mapping (server-side filters; client-side only where noted):

| Control | Behavior |
|---|---|
| "Whole Task Plan" dropdown | sprints from `getSprints`; value = `taiga_milestone_id` → `?milestone=`; default = `active_sprint`; "All" = no param |
| Status chips / All | client-side filter on loaded rows; counts always from `roll_up` (unchanged by filtering — §8) |
| Open / Closed / All | `?is_closed=` server-side |
| Search (debounced 300 ms) | text → `?search=` (matches `subject`); pure number → client-side `ref` match |
| Refresh | Flow B step 7; shows `last_synced_at` beside it |
| Pagination | `?page&limit`, infinite scroll or pager from `total_pages` |

### P4 — Task Plan panel (D3 + read-only D4)

`PlanPanel` renders `getPlanExecution`: nested `sprints[] → tasks[]/dependencies[]` with
`meta` (planned points, estimate_hours, priority, assignee_role), header progress from
`progress.percent` (`by_kind` for the tab badges). Ticks call `toggleExecutionItem`
(`:itemId` = execution `_id`) and take the fresh `progress` from the response — no refetch.
Overlay (§5.4): join `tasks[].ref_key` ⇄ `taiga_mappings.external_id` →
green **"In Taiga #<taiga_ref>"** deep link `https://tree.taiga.io/project/<slug>/task/<taiga_id>`
or grey **"Planned — not in Taiga"**. Live expectation: taigatests plan `6aae8c00…fa95`
= 42/42 green; Mgroc accepted plan = 0/51 grey + Create button.

### P5 — Refresh & publish actions (D4 actions)

Refresh → `syncProject` → refetch §2.1 on success; on 409/429 show `response.status.msg`
("a sync is already running / cooldown") without disabling the board. Publish flow follows
`docs/taiga_plan_publish_ui.md` verbatim (`preview → confirm → result → retry`); after a
successful publish, trigger `syncProject` so the board reflects Taiga immediately.

### P6 — Polish

SWR-style cache (60 s TTL) keyed `(integrationId, query)`; optimistic tick with rollback;
skeleton loaders per column; aria labels on chips/columns; telemetry: `board.load`,
`board.filter`, `plan.publish`, `sync.refresh`.

## 4. User flows

### Flow A — open the Tasks tab (happy path)

1. `getProjectIntegrations(projectId)` → pick `provider === 'taiga'` row → `integrationId`.
   Cache it on the project context.
2. No Taiga integration → **empty state**: "Connect Taiga to see your task board" +
   button to the Integrations section (`docs/taiga_plan_publish_ui.md` §5 has the modal).
3. `getTaigaTasks(integrationId, { limit: 100 })` + `getSprints(projectId)` in parallel;
   preselect `active_sprint` in the dropdown → refetch with `?milestone=` if one exists.
4. Render columns (`status_tabs` order) → lanes (`user_story_id`) → cards (server order).
5. Header: `roll_up.total_tasks / open_tasks / closed_tasks` + status chips with counts;
   "Last synced <last_synced_at, relative>".

### Flow B — refresh from Taiga

1. User clicks Refresh → button enters spinner (board stays interactive).
2. `syncProject(projectId)`. Success (30–60 s): toast with `items_synced`, then refetch
   step A3. 409/429: toast `response.status.msg` ("A sync is already running…"), no retry
   storm — re-enable after the stated cooldown. 400: toast msg, log trace.
3. If `derived_data_refreshed === false` → show warning chip "Analytics will catch up".

### Flow C — filter & search

1. Dropdown sprint change → server refetch with `?milestone=`; keep column set stable
   (columns come from `status_tabs`, not from visible rows — empty columns stay visible).
2. Status chip click → client-side; All resets; chip counts never change (§8 rule).
3. Search: debounce 300 ms; digits-only input filters `ref` client-side (instant), else
   server `?search=`; empty result → "No tasks match" inside the grid, not a page error.

### Flow D — view & tick the task plan

1. Plan tab/rail mount → `listPlans(projectId)` → newest `status in (accepted, published)`
   plan; none → "Generate a plan from the AI Plan screen" empty state (out of scope here).
2. `getPlanExecution(planId)` → render sprints → tasks; progress header; overlay chips via
   `getPlanTaigaSync(planId)` mappings (P4).
3. Tick a task checkbox → optimistic toggle → PATCH → update `progress` from response;
   on failure roll back + toast.
4. "Whole Task Plan" dropdown selection filters **both** layers: plan tasks by
   `parent_key === 'sprint-N'` and board tasks by that sprint's `taiga_milestone_id` (§5.3).

### Flow E — plan not yet in Taiga (Mgroc case, 0/51 mapped)

1. Plan rows all grey "Planned — not in Taiga"; plan header shows **Create in Taiga**.
2. Button → `create-in-taiga/preview` (dry run) → confirm modal listing
   `summary.milestones/user_stories/tasks` counts → `create-in-taiga`
   `{ mode:'sync', dry_run:false, allow_unassigned:true }`.
3. `status: 'completed'` → success toast → auto-run Flow B (sync) so mappings/board fill in.
   `partial`/`failed` → show `errors[]` rows + **Retry Taiga sync** button.
4. While publishing: keep button disabled only for the plan row, board unaffected.

### Flow F — plan already published (taigatests case, 42/42)

Rows show green "In Taiga #ref" deep links opening Taiga in a new tab; header shows
"Last synced <last_sync_at>" from `taiga-sync`; **Retry** only if `failed_count > 0`.

## 5. State & error matrix

| Case | Detection | UI |
|---|---|---|
| No Taiga integration | step A2 | connect empty state |
| Integration but never synced | `last_synced_at == null` | board with "Never synced" + prominent Refresh |
| Sync failed earlier | `sync_status` on integration row / sync-history | amber banner + Refresh |
| B1 regression (0 rows despite data) | `dataset.total === 0 && last_synced_at != null` | "0 tasks — data issue" + report link, **not** the empty state |
| Sync in progress / cooldown | 409/429 | toast msg, keep board |
| Plan not accepted | no plan with `status accepted|published` | plan CTA empty state |
| Plan accepted, unpublished | `taiga-sync.plan_published === false` | Flow E |
| HTTP 400 | `action_status === false` | toast `status.msg` |

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| B1 fix ships after UI | plan-only fallback (Flow D renders without the board); B1 regression test in CI |
| `limit 100` truncates big projects | paginate by sprint (`?milestone=`) — Mgroc max sprint ≈ 30 tasks |
| `taga-status-tabs` typo route | alias it in the client (`getStatusTabs`), leave server path as is |
| Schema drift on `dataset` | unwrappers validated against recorded fixtures in unit tests |
| Concurrent sync storms from many users | rely on backend project lease; UI treats 409/429 as normal |
| Plan `ref_key` join misses | grey "Planned" chip is the safe default; never invent a Taiga link |

## 7. Acceptance checklist (frontend)

- [ ] Project without Taiga → connect empty state; no board call fires.
- [ ] Mgroc demo 1: 59 cards, 5 Taiga-ordered columns, story lanes ("Web", …); taigatests: 42.
- [ ] Sprint dropdown = milestone param; "All" = no param; card counts match chips.
- [ ] Chip/open-closed/search filters work; chip counts stable under filtering.
- [ ] Refresh → spinner → `last_synced_at` updates; second immediate click → cooldown toast.
- [ ] Plan panel: 17 sprints / 51 tasks / 109 checklist rows; `progress.percent` in header.
- [ ] Tick → PATCH → progress updates without refetch; rollback on failure.
- [ ] taigatests rows deep-link to Taiga tasks; Mgroc rows show "Planned" + working Create-in-Taiga → board fills after auto-sync.
- [ ] 409/429 and HTTP 400 paths show `status.msg`, never a raw error.
- [ ] All payloads pass the fixture-tested unwrappers.

---

**Sources:** contracts `docs/taiga_taskboard_ui.md`; publish UX `docs/taiga_plan_publish_ui.md`;
backend spec `taiga_plan_publish_backend.md`. Verified live 2026-09-22.


