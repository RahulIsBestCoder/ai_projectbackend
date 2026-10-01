# Project Review Report — `ai_project` Backend API

**Review date:** 2026-09-19
**Reviewed by:** Technical Project Manager / Solution Architect review (AI-assisted)
**Scope:** Everything in `backendai/` (backend only — the frontend is not in this folder)

> **How to read this report**
> - Each important point is tagged:
>   - **FACT** — seen directly in the code, logs or config.
>   - **INFERENCE** — our best reading of the code, not tested by running it.
>   - **RISK** — something that could go wrong.
>   - **RECOMMENDATION** — what we suggest doing.
> - Evidence is given as `file:line` so anyone can check it.
> - Secret values were **not** copied into this report. We only name the kind of secret.
> - A short glossary is at the end if any term is unfamiliar.

---

## 0. Summary

**What it is:** A backend server (TypeScript + Express + MongoDB). It connects a software project to **GitHub** and **Taiga**, pulls in commits, code and tasks, and then uses **AI** plus rule-based maths to tell a manager:
- how healthy the project is;
- what the risks are;
- whether the deadline will be met.

It can also write sprint plans with AI and push them into Taiga.

**Overall health:** The product idea is strong and a lot of features are built. **It is not safe to put on the internet yet.**

**The 5 things that matter most right now:**

| # | Problem | Why it matters |
|---|---|---|
| 1 | **Anyone can reset anyone's password** by knowing only their email. | Full account takeover. |
| 2 | **Most API routes have no login check.** | Anyone can read, change or delete users, projects, reports and more, and can spend AI credits. |
| 3 | **Real-looking passwords and API keys** are in `.env` and hardcoded in 3 scripts. | If this folder is shared, those accounts are exposed. |
| 4 | **Long jobs run inside a single web request** (GitHub sync, AI chains, PDF). | Requests can take minutes, time out, or overload the server. |
| 5 | **There are no automated tests and no CI.** | Nobody can safely change code without breaking something. |

**Good news:**
- The code builds cleanly (`tsc --noEmit` passes).
- The module structure is consistent and easy to navigate.
- The health-score and deadline-forecast maths mostly follow the written rules.
- The one real access-control check that exists (`requireSyncAccess`) is well written. It just isn't used on enough routes.

---

## 1. Project Overview

### What problem does it solve?

Project managers often don't know the real state of a project. Tasks in Taiga say one thing, and the code in GitHub says another. This system **brings both together** and answers:

- *Is the project healthy?* → Health score (0–100) with reasons.
- *Will we hit the deadline?* → Probability forecast (Monte Carlo simulation).
- *What could go wrong?* → Risk list (rule-based + AI).
- *What if we add people or cut scope?* → "What-if" delay simulator.
- *What should we build next?* → AI-generated sprint plan, which can be published into Taiga.
- *What is happening in the code?* → AI chat that can read the synced repository.
- *Can I share a status report?* → AI-written report, downloadable as a PDF.

### Who uses it? (INFERENCE)

- Project managers and delivery leads (main users).
- Team leads (department / team views).
- Frontend app: an Angular app using Taiga UI, judging from the docs. **It is not in this repository.**

### Business value

It gives managers one place for the truth about progress, risk and deadlines, without manually comparing Taiga boards with GitHub activity.

### Main modules (13)

| Module | URL prefix | What it does, in one line |
|---|---|---|
| `auth` | `/v1/user` | Login, tokens, forgot/reset password |
| `user` | `/v1/users` | User create/read/update/delete |
| `organization` | `/v1/organizations`, `/v1/departments` | Organizations and "department" (team) views |
| `project` | `/v1/projects` | Projects, portfolio, dashboard, and the hub for most project pages |
| `integration` | `/v1/integrations` | Connect GitHub / Taiga, sync data, publish plans to Taiga |
| `git_intelligence` | `/v1/git_intelligence` | Repository list, commits, PRs, contributors |
| `ai_intelligence` | `/v1/ai`, `/v1/plans` | AI chat, analysis, reports, sprint plans, provider switching, token usage |
| `analytics` | `/v1/analytics` | Metric snapshots, health score, trends |
| `risk_prediction` | `/v1/risk-predictions` | Risks, deadline forecast, delay simulator |
| `sprint_intelligence` | `/v1/sprints` | Burndown, burnup, velocity, sprint comparison |
| `work_management` | `/v1/work-items` | Work items (tasks) from Taiga / manual / GitHub |
| `reporting` | `/v1/reports` | AI project reports and PDF download |
| `notification` | `/v1/notifications` | Notifications (storage only — nothing creates them yet) |

---

## 2. Architecture

```
        ┌──────────────────────────┐
        │  Frontend (NOT in repo)  │   Angular + Taiga UI (inferred from docs)
        └────────────┬─────────────┘
                     │ HTTPS  JSON   Authorization: Bearer <token>
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│ Express server  (src/app.ts)                                     │
│   helmet · cors(*) · json(150MB) · morgan → winston logs         │
│                                                                  │
│   /v1  (src/app_routing.ts)                                      │
│     Route  →  Middleware  →  Controller  →  Service  →  Model    │
│               validateToken      (HTTP)      (logic)   (Mongo)   │
│               requireSyncAccess                                  │
└───────┬──────────────┬───────────────┬──────────────┬────────────┘
        │              │               │              │
        ▼              ▼               ▼              ▼
   ┌─────────┐   ┌──────────┐   ┌─────────────┐  ┌───────────────┐
   │ MongoDB │   │ GitHub   │   │ AI providers│  │ Headless      │
   │ (Atlas) │   │ Taiga    │   │ Gemini/Grok/│  │ Chrome (PDF)  │
   │         │   │ APIs     │   │ Ollama      │  │ SMTP (email)  │
   └─────────┘   └──────────┘   └─────────────┘  └───────────────┘
```

**Stack (FACT):**
- Node 22, TypeScript 5 (`strict: false`), Express 4, Mongoose 8.
- MongoDB only: no SQL database and no Redis.
- Logging: winston + morgan.
- Auth: JWT wrapped in AES encryption.

**Code layout (FACT):**
- Every module has the same folders: `route / controller / service / middleware / interface / models`. This is a good, predictable pattern.

**Things that do NOT exist yet (FACT):**
- No background job queue or workers (the README mentions BullMQ/Redis "later").
- No Dockerfile, no CI pipeline, no automated tests.
- No git history in this folder.
- No global error handler.

**Largest files (FACT):**

| Lines | File | Comment |
|---|---|---|
| 2,882 | `src/domain/ai_intelligence/service/ai_intelligence_service.ts` | "God file": chat, reports, plans, execution, context and assessment all in one class |
| 1,387 | `src/domain/integration/service/integration_service.ts` | GitHub + Taiga sync together |
| 1,258 | `src/domain/risk_prediction/service/risk_prediction_service.ts` | Risks + two forecast engines |
| 718 | `src/domain/sprint_intelligence/service/sprint_intelligence_service.ts` | |
| 672 | `src/domain/integration/service/taiga_publish_service.ts` | |

---

## 3. Project Flows

### Flow A — Login

1. `POST /v1/user/login` with email + password → the server checks the password with bcrypt → returns an **authorization code**.
2. `POST /v1/user/generateToken` with that code → returns an **access token** (1 hour) and a **refresh token** (7 days).
3. The frontend sends `Authorization: Bearer <access_token>` on later calls.
4. `POST /v1/user/regenerateToken` → issues a new token pair.

**Problems:**
- There is no logout.
- Tokens cannot be revoked.
- Password reset is broken from a security point of view (see Issue C1).

### Flow B — Connect a repository and sync

1. `POST /v1/projects/:projectId/github/connect` saves the repo + token, then **syncs immediately inside the same request**.
2. The sync pulls commits, pull requests and a full **copy of the source code** into MongoDB.
3. After the sync, the server re-runs risk analysis, the deadline forecast and the project "context" text.

**Problems:**
- It is all done while the user waits.
- Large repositories cause one GitHub call per file.
- There is no rate-limit handling.
- Anything beyond 1,000 commits or PRs is silently ignored.

### Flow C — AI plan → Taiga

1. `POST /v1/plans` with a project description → AI makes a sprint plan. If the AI fails, a rule-based plan is used instead.
2. `POST /v1/plans/:id/accept` → turns the plan into a checklist (`plan_execution_items`).
3. The user ticks items done with `PATCH .../execution/...`.
4. `POST /v1/plans/:planId/create-in-taiga` → creates milestones, user stories and tasks in Taiga.

**Problems:**
- Once any sprint exists in Taiga, **sync and retry are refused** (`TAIGA_SPRINTS_EXIST`), so a half-failed publish cannot be finished.
- Double-clicking can create duplicates, because there is no unique index and no lock.
- Any logged-in user can publish any plan.

### Flow D — "Run AI assessment" (the Health button)

`POST /v1/projects/:projectId/ai-assessment/refresh` runs these steps **in one request**:
1. Optional sync.
2. AI health/quality score.
3. AI risk analysis.
4. Deadline forecast.
5. Context rebuild.

The UI doc (`plan.md`) says to allow about 2 minutes.

**Status:** Implemented (`project_service.ts:500-524`). Works as designed, but is slow and fragile because it is all inline.

### Flow E — Reports and PDF

1. `POST /v1/reports` → an AI call writes the report, inside the request. The result is cached by a hash of the input.
2. `GET /v1/reports/:id/download` → renders an EJS template → **launches a system Chrome/Edge** process to print a PDF.

**Problems:**
- Both endpoints have no login check.
- Every download starts a whole browser, with no limit on how many run at once.
- If the server crashes mid-report, the report stays "generating" forever (INFERENCE).

---

## 4. Current Implementation Status

> "Implemented" means the code exists and looks complete. It does **not** mean "Done". Nothing here meets a full Definition of Done, because there are no tests, security is not in place, and nothing is verified against the real frontend.

| Feature | Status | Notes |
|---|---|---|
| Login / token / refresh | **IMPLEMENTED** | Works; no logout or revocation |
| Forgot password / OTP / reset | **BLOCKED (security)** | Reset does not require the OTP — must be fixed before release |
| User management | **NEEDS REVIEW** | No auth; returns password hash; two conflicting user schemas |
| Roles and permissions | **NOT STARTED** | Tables exist only in scripts; permission check is an empty function |
| Organizations / departments | **IMPLEMENTED** | Department work-item count ignores the project filter |
| Projects, portfolio, dashboard | **IMPLEMENTED** | Only portfolio/dashboard check access |
| GitHub connect + sync | **IMPLEMENTED** | 1,000-item cap; line stats only for 50 commits; runs inline |
| Taiga read-sync | **NEEDS REVIEW** | Slug bug, hardcoded taiga.io URL, `$setOnInsert` bug, unique index failing (see logs) |
| AI plan generation + accept + checklist | **IMPLEMENTED** | Duplicate risk on double-click |
| Publish plan to Taiga | **IN PROGRESS** | Create works; sync/retry blocked; many spec items missing (see §6 H6) |
| AI chat / analysis / reports | **IMPLEMENTED** | Chat history is never saved; no provider fallback |
| AI provider switch + token usage | **IMPLEMENTED** | The switch is global for all users and has no auth |
| Health score (rule book) | **IMPLEMENTED** | 3 deviations from the written rules |
| Deadline forecast / delay simulator | **IMPLEMENTED** | Two different forecast engines exist side by side |
| Sprint analytics | **IMPLEMENTED** | Burndown shows an "estimated" curve when data is missing |
| Reports + PDF | **IMPLEMENTED** | Needs Chrome on the server; no auth |
| Notifications | **NOT STARTED** | Only storage; nothing in the app creates notifications |
| Automated tests / CI / Docker | **NOT STARTED** | Only ad-hoc `verify_*` scripts |
| Documentation | **TECHNICAL DEBT** | README says "only auth is implemented"; links to 4 files that don't exist |

---

## 5. Recent Change Analysis

**Limit:** This folder is **not a git repository**, so we cannot see real diffs, commits or authors. This section is based on file contents and the log file only.

What recent work appears to be (INFERENCE from files):

| Evidence | What it tells us | Affected area |
|---|---|---|
| `taiga_plan_publish_backend.md` + `docs/taiga_plan_publish_ui.md` | The newest feature is "publish AI plan to Taiga". About half the spec is done. | integration, ai_intelligence, frontend |
| `plan.md` | The "Run AI assessment" button: backend done, UI instructions written | project, analytics, risk |
| `implement_2layer.py` | A one-off Python script that edited `ai_intelligence_service.ts` by text replacement to add the "2-layer" plan generator. Its changes are already applied. It points to a different folder (`backend-2026`) and left old functions behind as dead code. | ai_intelligence |
| `logs/app-2026-09-19.log` | Taiga sync ran several times today, and **every time the `taiga_tasks` unique index failed to build**: `E11000 duplicate key … { project_id: null, integration_id: null, taiga_task_id: null }` | integration, database |
| `package.json` `copyassets` | The build script was changed to Windows-only commands (`xcopy`); the README still says it needs a POSIX shell | build / deployment |

**Change impact (Taiga index failure):**
- Old rows with missing keys block the unique index.
- Without the index, **duplicate Taiga tasks can be stored**.
- The Taiga issues index already solved the same problem with a "partial" index (`integration_service.ts:985`), but the tasks index did not (`:974`).

---

## 6. Issues Found

### CRITICAL

#### C1 — Anyone can reset any user's password
- **Severity:** CRITICAL
- **Component:** auth
- **Problem:** The reset endpoint takes only `email + new password`. It never checks that an OTP was verified.
- **Evidence (FACT):**
  - `src/domain/auth/service/auth_service.ts:382-408`: no OTP or reset token is checked.
  - `verifyOtp` (`:354-375`) only deletes the OTP and returns `{verified:true}`. Nothing links the two steps.
- **Impact:** Full account takeover of any user, without logging in.
- **Recommended action:**
  - `verifyOtp` must return a short-lived, single-use reset token.
  - `resetPassword` must require and check that token.
  - Also limit OTP attempts, use `crypto.randomInt` instead of `Math.random`, and never return the OTP in the API response.

#### C2 — Most endpoints have no login check at all
- **Severity:** CRITICAL
- **Component:** routing / all domains
- **Problem:** Authentication is added route by route, and most routes don't have it.
- **Evidence (FACT):**
  - `src/domain/user/route/user_route.ts:8-11`: create, get, update and delete user all have no auth.
  - The same is true for `/v1/organizations`, `/v1/projects` CRUD, `/v1/work-items`, `/v1/sprints`, `/v1/analytics`, `/v1/risk-predictions`, `/v1/reports`, `/v1/notifications`, `/v1/ai/*`, `/v1/plans`, `/v1/integrations` CRUD and `/v1/git_intelligence`.
- **Impact:**
  - `GET /v1/users/:id` returns the user's **password hash**.
  - `PUT /v1/users/:id` lets anyone set a new password hash.
  - Anyone can delete projects, read every organization's data, switch the AI provider for everyone, and spend AI credits.
- **Recommended action:**
  - Apply `validateToken` at router level to everything except `/v1/user/*` login routes.
  - Then add `requireSyncAccess` (project membership) to every route with a `:projectId` or a project-owned `:id`.

#### C3 — Secrets exposed in files and logs
- **Severity:** CRITICAL
- **Component:** configuration / scripts
- **Evidence (FACT):**
  - `.env` contains real-looking values for: a Gemini API key, a GitHub personal access token (stored under `GITHUB_CLIENT_SECRET`), Taiga username and password, and a MongoDB Atlas connection string with a password.
  - The same Atlas URI with password is **hardcoded** in `src/scripts/fix_relations.ts:3`, `src/scripts/backfill_commit_dates.ts:3` and `src/scripts/audit_relations.ts:3`.
  - `src/configuration/config.ts:12,18` prints the full DB URI, including the password, to the console on start.
- **Impact:** Anyone who gets this folder, or the server's console output, gets database and GitHub access.
- **Recommended action:**
  - **Rotate all these credentials now.**
  - Remove the hardcoded URIs and read them from env.
  - Stop logging the URI.
  - Add a `.env.example` with placeholders only.

### HIGH

| ID | Component | Problem | Evidence | Impact | Action |
|---|---|---|---|---|---|
| H1 | Access control | Some routes check login but **not project ownership**, so a user can act on another org's project by guessing its ID (IDOR). | `project_route.ts:49` (`/:projectId/sync`); `integration_route.ts:10-11`; `taiga_route.ts:16-25`; `taiga_plan_route.ts:27-50` (`requirePlan` only checks the plan exists) | Cross-customer data changes, syncs and Taiga publishes | Add `requireSyncAccess` or an equivalent owner check |
| H2 | Integration | GitHub tokens and Taiga passwords are stored **in plain text**. `git_intelligence.token` is returned by an unauthenticated GET. | `integration_model.ts:41-43`; `git_intelligence_service.ts:124-128` | A database leak or API call exposes third-party credentials | Encrypt at rest (the `INTEGRATION_ENCRYPTION_KEY` env var exists but is unused); never return tokens |
| H3 | Auth | **No rate limiting** anywhere. OTP comes from `Math.random`, verify attempts are unlimited, and the OTP is echoed in the response when not in production. | `app.ts` (no limiter); `common_helper.ts:233`; `auth_service.ts:337-340` | Brute force and AI-cost abuse | Add `express-rate-limit` on auth and AI routes |
| H4 | Taiga sync / DB | `$setOnInsert` is placed **outside** `update`, so it is ignored: new tasks never get `is_deleted:false`, and lists that filter `is_deleted:false` may hide them (INFERENCE). The unique index also fails to build (log). | `taiga_task_model.ts:87`; `integration_service.ts:974`; `integration_service.ts:434,456,478`; log `E11000` | Taiga tasks missing from UI lists; duplicate rows possible | Move `$setOnInsert` inside `update`; clean null-key rows or make the index partial like `:985` |
| H5 | Taiga sync | The project slug is read from fields that `/taiga/connect` fills with the project **ID** and **API URL**, so the slug becomes `"v1"` or a number. The base URL is hardcoded to taiga.io (self-hosted Taiga is ignored). | `integration_service.ts:1095,1122-1125`; `taiga_controller.ts:33-39` | Taiga sync fails for integrations created through connect | Store `taiga_project_id` / base URL in proper fields and use them |
| H6 | Taiga publish | After a first publish, **sync, retry and preview are all refused** because "sprints already exist". This contradicts the backend spec (`taiga_plan_publish_backend.md:374-377`). | `taiga_publish_service.ts:88,207` | A half-failed publish can never be completed | Decide the intended behaviour (see Questions); move the check to `create` mode only |
| H7 | Architecture | **Long work runs inside HTTP requests** with no job queue: repository sync (one GitHub call per file for big repos, all files held in memory), AI report chains (several AI calls in a row, each up to 100 s), and the PDF browser spawn. | `github_controller.ts:17-107`; `github_source_sync_service.ts:162-209`; `ai_intelligence_service.ts:710-1090`; `report_pdf_service.ts:36-70` | Timeouts, memory spikes, an easy denial-of-service, bad UX | Move to background jobs (BullMQ + Redis); return a job ID and let the UI poll |
| H8 | API contract | `GET /:projectId/predictions` spreads Mongoose documents without `.lean()`, so rows may come out as `_doc` / `$__` wrappers instead of flat fields (INFERENCE). | `risk_prediction_service.ts:120-124`; `model.ts:27-29` | The frontend may get unusable data | Use `.lean()` or `toObject()`; verify with a real call |

### MEDIUM

| ID | Area | Problem (short) | Evidence |
|---|---|---|---|
| M1 | Security | **Mass assignment**: the raw `req.body` is saved directly on create/update, and "update" is actually `updateMany` | `model.ts:47-50`; `user_service.ts:34,72`; `project_service.ts:86` |
| M2 | Security | NoSQL operator injection is possible through query strings (`?organization_id[$ne]=x`) | `project_controller.ts:116`; `notification_service.ts:105` |
| M3 | Security | `cors('*')` hardcoded (env `CORS_ORIGIN` ignored); 150 MB body limit; file uploads (multiparty) have no size or count limit | `app.ts:65-72`; `common_middleware.ts:33-60` |
| M4 | Security | AES-CBC with a **static IV** equal to the code default; insecure fallback keys (`'secret'`, `"undefined"`); no startup check of env values | `jwt_helper.ts:12-16,39`; `encrypt_decrypt_helper.ts:17-19` |
| M5 | Error handling | No global error handler or 404 handler; the AI controller returns raw `error.message`; every failure (even "not found") returns HTTP 400 | `app.ts:83-91`; `ai_intelligence_controller.ts:28,43,…` |
| M6 | Database | Two conflicting `users` schemas; whichever loads first wins, so the unique email index probably never applies (INFERENCE) | `auth/models/model.users.ts:3-18` vs `user/models/user_model.ts:7-10` |
| M7 | Database | Soft delete sets `is_deleted`, but the schema lacks the field, so Mongoose drops it (INFERENCE) and deletes do nothing | `organization_service.ts:97`; `user_service.ts:90` |
| M8 | Database | No unique index on `taiga_mappings` or plan execution items, so double-clicks create duplicates | `taiga_mapping_model.ts:6-7`; `ai_intelligence_service.ts:2235-2371` |
| M9 | AI | Every AI record says provider `google` / `gemini-1.5-flash`, even when Ollama or Grok did the work | `ai_intelligence_service.ts:594-595, 627-628, …, 2093-2094` |
| M10 | AI | An extra model-list network call is made before every AI call; the fallback provider is dead code; chat history is never saved | `provider_factory.ts:114-148,203-214`; `ai_intelligence_service.ts:25` |
| M11 | AI | The chat "question" regex doesn't match the real prompt format, so repository search probably uses the wrong keywords (INFERENCE) | `ai_intelligence_service.ts:61`; `repository_reader.ts:81-82` |
| M12 | AI / Security | Source sync stores **every** file of the repo, including `.env` files, and the AI search can read their contents | `github_source_sync_service.ts:8-10`; `repository_reader.ts:46-48` |
| M13 | GitHub sync | Silently stops at 1,000 commits/PRs; line counts only for the first 50 commits; no GitHub rate-limit handling | `integration_service.ts:645,682-705`; `github_client.ts:3-20` |
| M14 | Business logic | Probabilities use different scales (0–1 in some responses, 0–100 in others) | `project_service.ts:228`; `ai_intelligence_service.ts:1056` |
| M15 | Business logic | Two Monte Carlo forecast engines (one seeded with 10,000 runs, one random with 500 runs) give different answers for the same project | `risk_prediction_service.ts:177-231` vs `deadline_forecast.ts` |
| M16 | Business logic | Health score differs from the written rule book in 3 places: evidence (§10), sprint (§8) and feature (§6) | `health_rules_score.ts:69-72, 94-104, 109-121` |
| M17 | Performance | Same tables read twice; many independent DB calls run one after another; large collections loaded fully into memory | `health_rules_score.ts:212-265`; `risk_prediction_service.ts:404-477, 1060-1089` |
| M18 | Database | Main collections (`work_items`, `sprints`, `reports`, `risk_predictions`, `analytics_snapshots`) have no `project_id` index in their schema (only added by a one-off script) | `src/scripts/fix_relations.ts:6-15` |
| M19 | Code quality | God file `ai_intelligence_service.ts` (2,882 lines); 84 debug `console.log` lines in integration code, some dumping full GitHub payloads | `integration_service.ts:517-845` |
| M20 | Departments | Department metrics count work items across **all** projects, not the selected one | `organization_service.ts:430-432` |

### LOW

- `README.md` is out of date:
  - It says only `auth` is implemented.
  - It links to 4 files that don't exist (`docs/ai-connections.md`, `docs/github-source-sync.md`, `uigit.md`, `.env.example`).
  - The "Auth API" heading appears twice.
- The build script (`copyassets`) is Windows-only, so it won't build on Linux or CI servers.
- `tsconfig.json` has `strict: false`, so the compiler catches fewer bugs.
- Route typo: `/v1/sprints/:id/taga-status-tabs` (`sprint_intelligence_route.ts:14`).
- Dead code: `buildPlanPrompt`, `buildFallbackPlan`, `_buildProjectContextPrompt`, `checkAccessPermission`, `generateWithFallback`.
- `implement_2layer.py` is a leftover patch script and can be deleted.
- The Gemini API key is sent in the URL query string, so it can end up in proxy logs (`google_provider.ts:94`).
- Many `.env` keys are never read (`CORS_ORIGIN`, `LOG_LEVEL`, `REDIS_URL`, `DB_TRANSACTIONS`, `GITHUB_*`, `TAIGA_*`, …).
- `.gitignore` contains a literal `.md` line (probably meant something else) and duplicate entries.
- The notification list without `user_id` returns every user's notifications (`notification_service.ts:104-105`). This becomes HIGH once real notifications exist.

---

## 7. Frontend / Backend Contract Check

> The frontend code is **not in this folder**, so we compared the backend against the **UI instruction documents** in `docs/` and `plan.md`. **Needs verification** against the real frontend.

| # | Contract point | What the backend does | Risk |
|---|---|---|---|
| 1 | Response envelope | `{ response: { status: { action_status, msg }, dataset } }` (`common_helper.ts:55-65`) | OK. The UI must check `action_status`, not only the HTTP code |
| 2 | Validation errors | `validationErrorBuild` uses the key `data` instead of `dataset` (`common_helper.ts:98`) | The UI may read the wrong key |
| 3 | Some errors skip the envelope | `sync_access_middleware.ts:62-86` and `taiga_plan_route.ts:36-48` return a raw `{ message }` | The UI error parser may break on 403 / 404 |
| 4 | HTTP status codes | "Not found" and every service failure return **400** | The UI cannot tell "missing" from "bad input" |
| 5 | Probability scale | Portfolio `on_time_probability` and dashboard `deadline_probability` are 0–1; `deadline_meet_percentage`, `deliveryForecast.deadlineProbability` and `complete_percent` are 0–100 | Wrong numbers shown (e.g. "0.7%" instead of "70%") |
| 6 | Deadline percentiles | The TypeScript type says p50/p80/p95; the response sends p10/p50/p80/p90 with `p95: null` | The UI may show an empty p95 |
| 7 | Health rules score | Field names match the UI doc. Missing from the doc: the section basis `PLAN_CHECKLIST_TICKED` and a few reason codes (`NO_PROBABILITY`, `NO_COMMITTED_SCOPE`, …) | The UI shows raw codes instead of friendly text |
| 8 | Health rules auth | The UI doc says "usual session auth"; the route actually has **no** auth (`project_route.ts:62`) | Will change (break the UI?) when auth is added |
| 9 | Taiga publish | `allow_unassigned` defaults to **true**; the spec says **false** (`taiga_controller.ts:174`) | Tasks may be published without assignees unexpectedly |
| 10 | Taiga retry | The UI doc says retry is not possible after a partial publish; the backend spec says it should be | The two docs disagree — needs a product decision |
| 11 | AI project paths | Real path is `/v1/ai/projects/:id/ai/analyze` (router mounted at `/ai`); code comments say `/projects/:id/ai/analyze` | 404s if the UI follows the comments |
| 12 | Delay prediction | Matches the UI doc; the backend adds a few extra fields (harmless) | OK |
| 13 | Long requests | AI assessment, sync and report can take minutes | UI timeouts must be at least 120 s, or move to job polling |

**Important:** When auth is added to all routes (C2), **every frontend call** that currently works without a token will start getting 401. Coordinate this change with the frontend team.

---

## 8. Database Review

**FACT:**
- MongoDB only, through Mongoose 8, on one connection.
- No migration tool: schema changes happen through Mongoose definitions, manual `createIndex` calls and one-off "fix" scripts.

| Topic | Finding |
|---|---|
| Schema enforcement | About **187 raw `db.collection(...)` calls** bypass Mongoose, so no schema validation or type casting happens on those writes. |
| IDs | IDs are stored sometimes as strings and sometimes as ObjectId. Code has to match both forms (`{$in:[id, new ObjectId(id)]}`), which is a sign of inconsistent data. |
| Relations | Plain string foreign keys (`project_id`, `owner_id`), no `ref`/`populate`. Fine for Mongo, but nothing guarantees referential integrity. |
| Transactions | None. Multi-step writes (login tokens, Taiga publish, plan accept) can be left half-done. |
| Duplicate model | Two `users` schemas conflict (M6). |
| Leftover SQL ideas | `primaryKey` / `autoIncrement` in `organization_model.ts:9-10` and `user_model.ts:7` do nothing in Mongoose, so `organization_id` is never set. |
| Soft delete | Inconsistent: some code uses `is_deleted`, some `deleted_at`, some `is_active`; some schemas lack the field (M7). |
| Indexes | Missing `project_id` indexes on main collections (M18); missing unique indexes for mappings (M8); the `taiga_tasks` unique index **currently fails to build** (H4). |
| Expensive queries | Health, forecast and delay-simulator endpoints load whole collections per call. The delay UI calls it on every slider release. |

**Migration caution:**
- Before creating the `taiga_tasks` unique index, **find and fix the rows where `project_id / integration_id / taiga_task_id` are null**. They are probably old seeded data. The alternative is a partial index, as `taiga_issues` already uses.
- Before merging the two `users` schemas, **check the existing documents for duplicate emails**, or a new unique index will fail the same way.

---

## 9. Testing Gaps

**FACT:**
- There is no test framework, no `npm test` and no CI.
- The only checks are 13 `src/scripts/verify_*.ts` scripts. They are run by hand, and several connect to the **live** database.

**Most important tests to add, by risk:**

| Priority | What to test | Why |
|---|---|---|
| 1 | Password reset requires a valid, verified OTP | Critical security (C1) |
| 2 | Every non-login route returns 401 without a token; project routes return 403 for non-members | Critical security (C2, H1) |
| 3 | `requireSyncAccess`: owner, member, non-member, deleted user | The only real access check |
| 4 | Pure maths: `health_rules_score`, `deadline_forecast`, `delay_prediction`, `completion_resolver` | Easy to unit test, and the numbers are the core product value |
| 5 | Taiga publish: running twice creates no duplicates; partial failure is recorded; retry behaviour | Money/data in an external system |
| 6 | GitHub sync upserts: re-sync doesn't duplicate; two repos don't collide | Data correctness |
| 7 | Taiga task sync writes `is_deleted:false` and tasks appear in the list API | Regression for H4 |
| 8 | Response shapes of the main UI endpoints (contract tests) | Prevents frontend breakage |

**Recommendation:**
- Add Vitest or Jest, plus `mongodb-memory-server` so tests don't touch real data.
- Turn the useful `verify_*` scripts into proper tests.

---

## 10. Risks & Blockers

### Technical risks
- **Security**: C1–C3 and H1–H3 block any public or production release.
- **Scalability**: long in-request jobs, whole files held in memory during sync, one browser process per PDF.
- **Cost**: unauthenticated AI endpoints mean anyone can run up AI bills.
- **Data quality**: failing Taiga index, inconsistent ID types, mixed probability scales, two forecast engines.
- **Maintainability**: a 2,882-line service file; `strict: false`; no tests.

### Delivery risks
- **Docs promise things the code doesn't do** (Taiga retry; health-rules "session auth"), so the frontend may build against wrong assumptions.
- **README is stale**, so new developers get the wrong picture.
- **No CI and a Windows-only build**, so deployment to a Linux server will fail as-is.
- **Adding auth (C2) will break frontend calls** that currently work without tokens. This needs a coordinated release.
- The code headers show a single author on almost every file (INFERENCE), which is a key-person dependency.
- No git history, so no review trail and no easy rollback.

### External dependencies
| Dependency | Risk |
|---|---|
| GitHub API | Rate limits (no handling); large repos mean thousands of calls |
| Taiga API | No timeouts, no retry; self-hosted not supported by read-sync |
| AI providers (Gemini / Grok / Ollama) | Timeouts up to 100 s with retries; no cross-provider fallback |
| Chrome / Edge on the server | PDF download fails if it's not installed |
| MongoDB Atlas | Credentials exposed (C3); the server starts even if the DB is down |
| SMTP | `SEND_EMAIL=0`: password-reset emails are not actually sent |

---

## 11. Next Development Priorities

```
1. Security hotfix (reset, secrets)
        ↓
2. Auth + project access on every route
        ↓
3. Fix Taiga data bugs + missing indexes
        ↓
4. Test harness + CI + cross-platform build
        ↓
5. Background job queue for sync / AI / PDF
        ↓
6. Unify API contracts + update docs
        ↓
7. Finish Taiga publish (sync/retry), notifications, logout, roles
        ↓
8. Refactor the large service files
```

**Why this order:**

1. **Security hotfix first.** Account takeover and leaked credentials are live dangers today. They are small code changes plus a credential rotation.
2. **Auth everywhere next.** Nothing else matters if anyone can delete data. It also changes the frontend contract, so it should happen **before** more UI work is built on open endpoints.
3. **Taiga data bugs.** The logs show the index failing *right now*, and users may already be missing tasks. These are small, targeted fixes.
4. **Tests + CI before bigger changes.** Steps 5–8 touch a lot of code. Without tests, each step risks silent breakage. The build must also run on Linux to deploy.
5. **Job queue.** This removes timeouts and denial-of-service risk, and it's needed before real users with big repos arrive. Redis/BullMQ is already planned in the README.
6. **Contracts.** Once the architecture is stable, fix the probability scales, pick one forecast engine, return proper HTTP codes, and update the docs. The frontend can then rely on the API.
7. **Finish features.** Taiga retry/sync (after a product decision), notifications, logout/revocation, roles.
8. **Refactor last.** Splitting the god files is valuable, but it's safest once tests exist.

---

## 12. Questions / Uncertainties

These cannot be answered from the repository. **Needs verification** with the team.

1. **Where is the frontend?** Which fields does it actually read? (All contract findings in §7 are based on docs, not real UI code.)
2. **Taiga publish:** should the user be able to retry or re-sync a plan after a partial publish? The two docs disagree.
3. **Multi-tenant?** Must organizations be fully isolated from each other? Today there is no organization-level scoping at all.
4. **Roles:** what roles are planned (admin, PM, member, viewer)? What may each do?
5. **Deployment target:** Linux server, Docker, cloud? This decides the build-script fix and how Chrome gets installed for PDFs.
6. **Are the `.env` keys and the Atlas database real or production?** If so, rotation is urgent.
7. **Is there a git repository somewhere else?** Without history we cannot tell what changed recently or who reviewed it.
8. **Is the 1,000-commit sync limit acceptable** for your largest repositories?
9. **Which health rules are correct:** the rule book (`docs/project_health_scoring_rules.md`) or the current code? (See M16.)

---

## Glossary

| Term | Simple meaning |
|---|---|
| **JWT** | A signed "ticket" the server gives after login; the app sends it with each request to prove who you are. |
| **OTP** | One-time password, e.g. a 6-digit code sent by email. |
| **IDOR** | "Insecure Direct Object Reference": changing an ID in the URL lets you see or change someone else's data. |
| **Index** | A database "table of contents" that makes lookups fast. A *unique* index also blocks duplicates. |
| **Upsert** | "Update if it exists, insert if it doesn't." |
| **Idempotent** | Doing the same action twice gives the same result as doing it once (no duplicates). |
| **N+1 queries** | Making one call per item in a loop instead of one call for all items; slow at scale. |
| **Job queue** | A list of background tasks processed by workers, so the web request can return immediately. |
| **Mass assignment** | Saving whatever the client sends, which lets them set fields they shouldn't (like `password_hash`). |
| **Monte Carlo** | Running thousands of random "what could happen" simulations to estimate a probability. |
