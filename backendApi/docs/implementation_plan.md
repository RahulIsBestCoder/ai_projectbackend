# Backend Implementation Plan

**For:** backend developers and the coding agent. The frontend team should read the "Frontend impact" lines.
**Based on:** `report.md` (backend review, 2026-09-19) and `frontendai/backend requirement .md` (2026-09-20).
**Status:** Plan only. Nothing is implemented yet.

**Rules for every step**
- A step is **done** only when its "Done when" checks pass as automated tests. Code existing is not enough.
- Every response uses the standard envelope, and every error has a `code` (see Step 3).
- No step changes an API shape without a line under "Frontend impact".
- Do not ship one step to production before the one before it. Steps 1–2 especially must ship together or in order.

---

## Step 0 — Test harness (1–2 days, do first)

**Why first:** Steps 1–4 change login and access control on every route. Without tests, nobody can prove they didn't lock out real users or leave a hole open.

**Work**
- Add Vitest + Supertest + `mongodb-memory-server` (dev dependencies).
- Add `npm test`. Tests must never read `.env` or touch the Atlas database.
- Split `src/app.ts` into `createApp()` (builds the Express app) and `listen()`. Tests can then load the app without starting a server.
- Add `tests/helpers/`: `seedUser(role)`, `seedOrg()`, `seedProject(org, owner)`, `loginAs(user)` (returns a Bearer token).
- Make `copyassets` work on every OS (a small Node script instead of `xcopy`).
- Add GitHub Actions (or similar) CI that runs `npm ci`, `npm run typecheck`, `npm test` and `npm run build`.

**Done when:** `npm test` runs one smoke test (`GET /` → 200) on Windows and in CI.

---

## Step 1 — Security hotfix

### 1a. Password reset tied to the OTP (P0-4)
**Files:** `src/domain/auth/service/auth_service.ts`, `src/domain/auth/middleware/auth_middleware.ts`, `src/domain/auth/models/model.user_otp.ts`, `src/helper/common_helper.ts`

**Work**
- `verifyOtp`: on success, create a random `reset_token` with `crypto.randomBytes(32)`. Store only its **SHA-256 hash** on the OTP row (or a new `password_resets` collection) with `expires_at` = now + 10 min and `used_at: null`.
  - Return `{ reset_token, expires_at }`.
- `resetPassword`: require `{ email, reset_token, password, confirm_password }`.
  - Look up the hash for that email, check it isn't expired or used, then mark it used **atomically** (`findOneAndUpdate` with `used_at: null` in the filter).
  - Any failure returns `400 INVALID_RESET_TOKEN`.
- OTP generation: use `crypto.randomInt(100000, 1000000)` instead of `Math.random`.
- Lock the OTP after 5 wrong attempts: add an `attempts` counter on the row.
- Stop returning the OTP in the response. Keep it only behind an explicit `EXPOSE_OTP_FOR_DEV=1` flag, never tied to `NODE_ENV`.
- Password policy: at least 8 characters, with at least 1 letter and 1 number. Failures return `VALIDATION_ERROR`.
- After a reset, revoke existing tokens for that user by deleting their `login_tokens` rows. Step 2 makes this effective.

**Done when:** tests prove:
- a reset without a token fails;
- a reset with someone else's token fails;
- a token cannot be used twice;
- an expired token fails;
- the 6th wrong OTP fails even if it is correct.

**Frontend impact:** send `reset_token` from `verifyOtp` to `resetPassword` (already planned in the requirement doc).

### 1b. Remove leaked secrets from code and logs
**Files:** `src/configuration/config.ts`, `src/scripts/fix_relations.ts`, `src/scripts/backfill_commit_dates.ts`, `src/scripts/audit_relations.ts`, new `.env.example`

**Work**
- Replace the hardcoded Atlas URIs in the 3 scripts with `process.env.MONGODB_URI`.
- `config.ts:12,18`: log only the host name, never the full URI.
- Create `.env.example` with placeholders for every key the code actually reads.
- Add a startup config check (`src/configuration/env.ts`): **refuse to start** if `JWT_SECRET`, `REFRESH_TOKEN_KEY`, `SECRET_KEY` or `IV` are missing, shorter than 32 characters (16 for `IV`), or equal to the known default values.
- **Manual (not code):** rotate the Atlas password, GitHub token, Gemini key, Taiga password and the JWT/AES secrets. Rotating the JWT secret logs everyone out, which is expected.

**Done when:** `grep` for `mongodb+srv://` finds nothing under `src/`, and the app refuses to boot with the placeholder secrets.

### 1c. Stop returning integration secrets (P0-2)
**Files:** `src/domain/git_intelligence/service/git_intelligence_service.ts`, `src/domain/integration/service/integration_service.ts`

**Work**
- Apply a `publicRepository()` projection in `git_intelligence` (same idea as `publicIntegration`, `integration_service.ts:30-40`).
- Add `has_token`, `has_password` and `has_auth_token` flags to both. Never return `token`, `password` or `auth_token`.
- Add one test that scans every integration and repository response body for these keys.

**Done when:** that test passes for `GET/POST/PUT /integrations`, `GET /projects/:id/integrations`, `GET /git_intelligence/:id` and `GET /projects/:id/repositories`.

**Frontend impact:** show "Token saved ✓" from `has_token`.

---

## Step 2 — Login on every route + organizations and roles + `/user/me` (P0-1 + P2-RBAC)

### 2a. Data model: who belongs to which organization
**Today (FACT):**
- Users have **no `organization_id`**.
- Roles (`super_admin`, `org_admin`, `project_manager`, `member`, `viewer`) exist only in seed scripts (`seed_defaults.ts:120`).
- `project_members` is the only membership data.

**Work**
- New collection `organization_members`:
  `{ organization_id: string, user_id: string, role: 'org_admin'|'project_manager'|'member'|'viewer', is_deleted, created_at, updated_at }`
  - Unique index on `(organization_id, user_id)`.
- `super_admin` stays a platform role in `user_roles`. It is not per organization.
- **Migration script** `src/scripts/migrate_org_members.ts`:
  - For every non-deleted project, add its `owner_id` as `org_admin` and each `project_members` user as `member`, in that project's `organization_id`.
  - Idempotent (upsert). Prints what it did. Has a `--dry-run` mode.
- **ID cleanup in the same migration:** store all `user_id`, `project_id` and `organization_id` references as **strings of the ObjectId**. Then the `{$in:[id, ObjectId(id)]}` workarounds can be removed later.
- Merge the two `users` schemas into one (`auth/models/model.users.ts`). Delete `user/models/user_model.ts`.
  - Before adding a unique `email` index, run a check that lists duplicate emails and stops if any exist.

### 2b. Middleware
**Files:** new `src/helper/access_middleware.ts`; update `common_middleware.ts`, `sync_access_middleware.ts`

| Middleware | Does |
|---|---|
| `requireAuth` | Replaces `validateToken`. Verifies the JWT, loads the user (active, not deleted), puts it on **`req.auth`** (not `req.body.loginDetails`, which the client can fake). Returns 401 `UNAUTHENTICATED`. |
| `requireProjectAccess(minRole)` | Resolves the project from `:projectId`, or from `:id` for integrations, plans, reports, work-items, sprints and so on (one resolver per resource). The user must be `super_admin`, or an organization member of the project's organization with a role ≥ `minRole`. Returns 404 `NOT_FOUND` if missing, 403 `FORBIDDEN` otherwise. |
| `requireOrgRole(minRole)` | Same, for `:organizationId` routes. |

- Role order: `viewer < member < project_manager < org_admin < super_admin`.
- **Default rule:** `GET` needs `viewer`, writes need `member`. Members, settings and deletes need `org_admin` (see the matrix below).
- Keep `requireSyncAccess` as an alias of `requireProjectAccess('member')` while migrating, then delete it.

### 2c. Apply to routes
- `app_routing.ts`: mount `requireAuth` **once**, for everything except `/user/login`, `/user/generateToken`, `/user/regenerateToken`, `/user/forgotPassword`, `/user/verifyOtp`, `/user/resetPassword`, and `GET /feature-flags` (decide whether that one stays public).
- Add `requireProjectAccess` to every project-scoped route in: project, integration, taiga, taiga-plan (replace `requirePlan`), git_intelligence, work-items, sprints, analytics, risk-predictions, reports, ai (project routes + plans), notifications (own user only).
- **List endpoints filter by access:**
  - `GET /projects`, `/organizations`, `/plans` and `/reports` return only what the user can see. Reuse `getAccessibleProjectIds` (`sync_access_middleware.ts:33-49`) and extend it with organization membership.
- `POST /ai/providers/switch`: `org_admin` or higher (it changes behaviour for everyone; see Step 5 P1-7).
- `/users` routes:
  - `GET /users/:id`: self or `org_admin` of a shared organization. **Never return `password_hash`.**
  - `POST /users` → `org_admin` only, and only through "invite member" (P2). `PUT` has a field whitelist and never accepts `password_hash`, `role_id` or `user_status` from the body.

### 2d. Stop mass assignment
- `src/model.ts`: add `updateOneRecord(filter, patch)` that uses `updateOne`. Switch every single-record update to it. Keep `updateAnyRecord` only where multi-update is intended.
- Every create/update controller passes the body through a per-resource **whitelist** (`pick(body, ALLOWED_FIELDS)`). `owner_id`, `organization_id`, `is_deleted` and `password_hash` can never come from the body.
- Enable `mongoose.set('sanitizeFilter', true)` and reject query-string values that are objects (NoSQL operator injection).

### 2e. `/user/me` and logout
- `GET /v1/user/me` returns the `user` object from the requirement doc: `_id`, `email`, names, `role` (highest), `organization_id` (default = first membership), and `organizations[{_id, name, role}]`.
- `generateToken` also returns `user`.
- `POST /v1/user/logout` deletes the `login_tokens` row.
- `requireAuth` checks that the token's session row still exists, so logout and password reset actually revoke access. Cost: one indexed lookup per request.

### Role matrix (proposal — product owner to confirm)

| Action | viewer | member | project_manager | org_admin | super_admin |
|---|---|---|---|---|---|
| Read project data, dashboards, reports | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit work items, tick plan items, chat with AI | ❌ | ✅ | ✅ | ✅ | ✅ |
| Sync, generate/accept plans, publish to Taiga, run AI assessment | ❌ | ❌ | ✅ | ✅ | ✅ |
| Create/delete projects, manage integrations and credentials | ❌ | ❌ | ❌ | ✅ | ✅ |
| Manage organization members, settings, AI provider | ❌ | ❌ | ❌ | ✅ | ✅ |
| Any organization | ❌ | ❌ | ❌ | ❌ | ✅ |

**Done when:** a test matrix passes for every route:
- no token → 401;
- another organization's user → 403 (404 for lists: they simply don't see the item);
- the lowest allowed role → 2xx;
- one role below it → 403.

Also, `GET /projects` for a user in organization B never returns organization A's projects.

**Frontend impact (breaking):**
- Every call must send a token.
- Remove the hard-coded organization ID (`src/App.tsx:65`).
- Use `/user/me` after reload.
- Hide controls based on the role.

**Release plan:** ship the backend with a feature flag `ENFORCE_AUTH=log-only` first. In that mode, log what *would* be blocked for 2–3 days, fix frontend calls, then switch to `enforce`.

---

## Step 3 — Standard error envelope, error codes, 404s (§0.2)

**Files:** `src/helper/common_helper.ts`, new `src/helper/app_error.ts`, `src/app.ts`, every controller (mechanical change)

**Work**
- Add `class AppError { httpStatus, code, msg, dataset? }` with helpers: `notFound()`, `forbidden()`, `validation(errors)`, `conflict(code)`, `tooMany(code, dataset)`.
- Services **throw** `AppError`, or return `makeBadServiceStatus(msg, dataset, code, httpStatus)`. `makeBadServiceStatus` gains optional `code` and `httpStatus` so existing services can be migrated gradually.
- `buildBody` puts `code` in `status.code` **and** a copy in `dataset.code` (the frontend reads `dataset.code` today; remove the copy once the frontend switches).
- `validationErrorBuild` uses `dataset.errors: { field: message }` (not `data`), with HTTP 422 and code `VALIDATION_ERROR`.
- Add a **global 404 handler** (`NOT_FOUND`) and a **global error handler** (`INTERNAL_ERROR`, 500) at the end of `app.ts`. It catches JSON parse errors (400 `VALIDATION_ERROR`) and never sends stack traces or file paths.
- Add process handlers for `unhandledRejection` / `uncaughtException` (log, then exit cleanly) and a graceful shutdown.
- Move bare `res.status().json({message})` calls to the envelope: `sync_access_middleware.ts:62-86`, `taiga_plan_route.ts:36-48`, domain middlewares, `reporting_controller.ts:109`.
- Remove raw `error.message` from `ai_intelligence_controller.ts`.
- Single-record GETs return **404 `NOT_FOUND`** instead of 400 or an empty dataset.
- Sync codes: `NO_GITHUB_INTEGRATION` 400, `SYNC_IN_PROGRESS` 409, `SYNC_COOLDOWN` 429 + `next_sync_available_at` (wire into `github_sync_guard.ts`).
- Add `express-rate-limit`:
  - `/user/login` and OTP routes: 10 per 15 min per IP + email;
  - AI routes: per-user limits;
  - over the limit: 429 `RATE_LIMITED`.
- Tighten config:
  - `cors({ origin: CORS_ORIGIN list })`;
  - JSON body limit 2 MB (larger only on routes that need it);
  - multiparty limits (size and count), or remove it if it is unused.

**Done when:**
- Tests assert that every error in the test suite has `status.code`, `action_status:false` and no `stack`.
- An unknown route returns 404 `NOT_FOUND`; malformed JSON returns 400.

**Frontend impact:** read `status.code`, and handle 404/409/422/429 as the requirement doc describes.

---

## Step 4 — Plans live only on the server (P0-3)

**Files:** `src/domain/ai_intelligence/{route,controller,service,middleware,models/ai_plan_model.ts}`, `app_routing.ts` (plan alias)

**Work**
- **Model:**
  - status is `draft | accepted | superseded`;
  - add `generated_by` (`<provider> | heuristic-fallback | manual`);
  - fix `provider`/`model` so they record what was actually used (today they are always `google`);
  - add `updated_by`.
- **Index:** a partial unique index on `(project_id)` where `status = 'accepted'` and `is_deleted = false`. This guarantees one accepted plan per project.
- **Endpoints:**

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/plans?project_id&status&page&limit&sort=-created_at` | Paginated; filtered to accessible projects |
| `POST` | `/plans` | AI generation as today; `{ manual: true, plan }` stores a manual plan (validated, no AI call) |
| `PUT` | `/plans/:id` | Partial `{ name?, plan? }`, validated with a schema (see below). For accepted plans, see the decision below. |
| `DELETE` | `/plans/:id` | Soft delete. Refused with 409 `PLAN_PUBLISHED` if already published to Taiga. |
| `POST` | `/plans/:id/accept` | In one transaction-like sequence: set other accepted plans in the project to `superseded`, set this one to `accepted` + `accepted_at`, create execution items. A double-click is safe thanks to the unique index + `409 PLAN_ALREADY_ACCEPTED`. |

- **Plan validation:** add a `SprintPlan` schema check (zod or hand-written) used by `PUT`, manual `POST`, *and* the AI output parser (`parsePlanResponse`, `ai_intelligence_service.ts:1855`). Today the AI output is stored unvalidated.
- **Execution items:** add a unique index on `(plan_id, kind, external_id)` so re-accept cannot duplicate them. Re-accept must **keep** existing `is_completed` ticks for items that still exist.
- Turn off ETag on `/plans/:id/execution` (`Cache-Control: no-store`) so it never returns 304 (requirement doc Q10).
- Access (from Step 2): `project_manager` or higher to create, edit, accept or delete; `member` to tick items.

**Decision needed:** editing an **accepted** plan.
- **Recommendation:** allow it, and sync the execution items. Add new items, soft-delete removed ones, keep ticks on unchanged ones, keyed by `external_id`.
- If the plan was already **published to Taiga**, return 409 `PLAN_PUBLISHED` until Taiga re-sync is fixed (see Step 6, Taiga).

**Done when:**
- Accept and edit in browser A; browser B and the Execution tab show the same plan.
- Two concurrent accepts leave exactly one accepted plan.
- Re-accept keeps the ticks.

**Frontend impact:** delete the localStorage plan store.

---

## Step 5 — P1 data items (start after the product owner answers the 3 decisions below)

**Decisions needed first:**
1. Can an accepted plan be edited? (Step 4 — recommendation above.)
2. Work-item status list. **Proposal:** `todo | in_progress | in_review | blocked | done | cancelled`. Old values map as `completed`/`closed` → `done`, anything unknown → `todo`, with a migration.
3. Project status codes. **Proposal:** `1 active · 2 on_hold · 3 completed · 4 archived · 5 cancelled`.

| Item | Work | Main files | Done when |
|---|---|---|---|
| **P1-1 Risk prediction record** | `analyze` also writes one prediction row. `delay_probability` comes from the existing delay-prediction baseline (`delay_prediction_service.ts`). `feature_importances` come from its driver contributions. `predicted_finish_date` = deadline forecast p50. `provider`/`model` = actually used. `GET /predictions` returns the latest record using `.lean()` (fixes the `_doc` wrapper issue). Unknown values → `null`. | `risk_prediction_service.ts`, `delay_prediction_service.ts` | Both endpoints return the documented shape; no field is `0` when it has no evidence |
| **P1-2 Analytics bundle** | Add `velocity`, `pr_metrics`, `code_churn`, `bug_metrics`, `qa_capacity`, `computed_at` to `GET /projects/:id/analytics`. Merge time comes from PR `created_at` → `merged_at`. Review latency needs PR review data, which **sync does not fetch today**: add `/pulls/:n/reviews` to the sync (limit 5 at a time; only for PRs updated since the last sync). Until then return `null`. Churn is summed from commits in the window; return `null` when stats are missing (only 50 commits have stats today, so raise that cap in the same change). Bugs come from `taiga_issues`. Coverage has no data source → `null`. Add `review_time_hours` to each PR. | `analytics_service.ts`, `integration_service.ts`, `git_intelligence_service.ts` | The bundle matches the documented shape; `null`, not `0`, where there is no data |
| **P1-3 Completion forecast** | The backend already nests `p50`/`p80`/`p95` under `forecast` (FACT). Remaining work: make **all probabilities 0–100 or all 0–1**. Proposal: 0–100 everywhere, named `*_percent`; keep the old field for one release. Longer term, retire the older unseeded 500-run engine (`risk_prediction_service.ts:177-231`) in favour of the seeded `deadline_forecast.ts`. | `risk_prediction_service.ts`, `project_service.ts:228`, `ai_intelligence_service.ts:1056` | One scale in every response; same input gives the same forecast |
| **P1-4 Work items** | Enforce the status and priority enums (after decision 2). Add `assignee_name` with one batched `$in` user lookup. Confirm and document `GET /projects/:id/members` → `[{_id, name, email}]`. | `work_management_*`, `project_service.ts` | Kanban shows real priority and names |
| **P1-5 Project status** | Document the codes (after decision 3). Add a computed `delivery_status`: `on_track` if on-time probability ≥ 70, `at_risk` if 40–69, `delayed` if < 40 or past the target date, `null` if there is no forecast. Thresholds match the health-rule bands. | `project_service.ts` | `status` and `delivery_status` are independent |
| **P1-6 Sync results** | Every sync response and history row uses `records_synced: {commits, pull_requests, stories, tasks}` plus a numeric `items_synced` total. Fixes history totals that currently count the object as 0 (`integration_service.ts:360`). Add `duration_ms` and `error_message`. `POST /projects/:id/sync` uses the Step 3 codes. Update or delete the stale `docs/integration-sync-postman.md` in the frontend repo. | `integration_service.ts`, `project_service.ts:440-467`, `github_sync_guard.ts` | History totals are correct; Navbar Sync gets 409/429 codes |
| **P1-7 AI attribution** | Every AI response includes the `provider` and `model` actually used. Stop hard-coding `google`/`gemini-1.5-flash` (`ai_intelligence_service.ts:594-595` etc.). Persist the provider and model choice in a settings collection (per organization, or global — **decide**) instead of static memory (`provider_factory.ts:31-33`), so it survives restarts. The `ai-assessment/refresh` body already accepts `{sync, provider, model}` (FACT). | `provider_factory.ts`, `ai_intelligence_service.ts`, `project_service.ts` | The UI shows the real provider and model; the choice survives a restart |
| **P1-8 What-if** | **Reuse** the existing `POST /projects/:id/ai/delay-prediction/simulate` rather than building a new endpoint. Document its body for the frontend. Add `team_size` as a driver only if product wants it. | `delay_prediction_service.ts` | The simulator changes its result when inputs change |

---

## Step 6 — P2 features

**Foundation first: background job queue.**
- Add BullMQ + Redis (`REDIS_URL` already in `.env`).
- Move GitHub/Taiga sync, report generation, PDF export and the AI assessment to jobs.
- Each job endpoint returns `{ job_id, status }`; add a status endpoint.
- Many P2 items (report generate/status/export/send) assume this, and it fixes the in-request timeout and denial-of-service risk (report H7).

| Area | Work | Depends on |
|---|---|---|
| Reports | `POST /reports/:id/generate`, `GET /reports/:id/status`, `GET /reports/:id/export/:fmt` (pdf now; csv/xlsx/html later), `POST /reports/:id/send` (SMTP) | Job queue |
| Notifications | Emitter service called on `risk_alert`, `deadline_slip`, `sync_failed`, `sprint_closeout`, `report_ready`. `PATCH /:id/read`, `PATCH /read-all`, preferences `GET/PUT /notification-preferences`. The list is always the current user's only. | Step 2 |
| Organization | `GET/PUT /organizations/:id/settings`; members `GET/POST/DELETE` (invite by email creates the user + membership; role `org_admin` = "Admin") | Step 2 |
| Teams / employees | `teams` collection + CRUD; `GET /employees` built from organization members + user profile | Step 2 |
| Departments | `PUT/DELETE /departments/:id`; fix metrics to filter by project (`organization_service.ts:430-432`) | — |
| Projects list | `GET /projects?search&status&sort&page&limit` (limit capped at 100; search escaped) | Step 2 |
| Sprints | `retrospective_notes` on `PUT /sprints/:id` | — |
| Settings | `GET /feature-flags` in the requirement doc's shape; `GET /integrations/providers` | — |
| Health | Confirm or implement `PUT /projects/:id/health/strategy` | — |
| Taiga (from report) | Fix `$setOnInsert` (`taiga_task_model.ts:87`), clean null-key rows, then build the unique index. Fix the slug/base-URL bug. Unique index on `taiga_mappings`. Decide and implement retry/sync after the first publish. | **Do this early** — it is a live data bug; it can run in parallel with Step 1 |

---

## Timeline (rough, one backend developer)

```
Week 1   Step 0 test harness + Step 1 security hotfix  (+ Taiga data-bug fix in parallel)
Week 2-3 Step 2 auth / org / roles / me   → ship in log-only mode, then enforce
Week 3   Step 3 error envelope + rate limits
Week 4   Step 4 plans on server
Week 5-6 Step 5 P1 data items (after product decisions)
Week 7+  Step 6 job queue, then P2 features
```

## Decisions needed from the product owner

| # | Decision | Needed for |
|---|---|---|
| 1 | Confirm the role matrix (Step 2) | Step 2 |
| 2 | Is `GET /feature-flags` public or login-only? | Step 2 |
| 3 | Can an accepted plan be edited? (recommendation: yes, sync the items; block if published to Taiga) | Step 4 |
| 4 | Work-item status list | Step 5 P1-4 |
| 5 | Project status codes 1–5 | Step 5 P1-5 |
| 6 | Probability scale: 0–100 everywhere? | Step 5 P1-3 |
| 7 | AI provider choice: per organization or global? | Step 5 P1-7 |
| 8 | Taiga: allow retry/sync after a partial publish? | Step 6 |
