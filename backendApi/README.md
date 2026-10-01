# ai_project Backend API

TypeScript / Express / Mongoose modular-monolith REST backend, built to the
architecture in [`plan.md`](./plan.md).

**This build contains:** the full shared/global infrastructure + the **`auth`**
domain. The other nine domains from the plan are not implemented yet; they mount
into `src/app_routing.ts` the same way `auth` does.

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node 22+, TypeScript 5.5 (CommonJS, `target es2016`) |
| Web | Express 4 |
| DB | MongoDB via Mongoose 8 (single connection on `global.db`) |
| Auth | 2-step OAuth-code -> AES-wrapped JWT access/refresh; email-OTP password reset |
| Responses | single envelope `{ response: { dataset, status, publish } }` |
| Logging | winston (console + daily file) + morgan |

## Layout

```
src/
  app.ts                     entry: globals, middleware pipeline, listen
  app_routing.ts             /v1 aggregator (mounts /user -> auth)
  model.ts                   base Mongoose repository class
  configuration/             config (db), winston, log_config
  helper/                    common_helper (global.Helpers), common_middleware,
                             jwt_helper, encrypt_decrypt_helper, sendEmail_helper,
                             helper_config, common_interface
  domain/auth/
    route/ controller/ service/ middleware/ interface/ models/
  scripts/seed.ts            seeds the `Web` client + one active user
  views/                     error.ejs, index.ejs, email_templates/
```

## Installation

### Prerequisites

| Requirement | Notes |
|---|---|
| Node.js | 22+ (matches `@types/node` 22 and `target es2016`) |
| npm | ships with Node |
| MongoDB | local (`mongodb://127.0.0.1:27017/`) or a hosted cluster; set via `MONGODB_URI` |
| Redis | optional — only needed once BullMQ workers are wired; not read by current code |

### Steps

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment**

   ```bash
   cp .env.example .env
   ```

   `.env.example` holds demo/placeholder values. Copy it to `.env` and replace
   anything marked `# CHANGE ME` for real integrations. Key values:

   | Var | Purpose | Default |
   |---|---|---|
   | `PORT` | HTTP port | `3000` |
   | `MONGODB_URI` | MongoDB connection string | Atlas cluster (change to your own) |
   | `DB_NAME` | database name | `ai_project` |
   | `JWT_SECRET` / `REFRESH_TOKEN_KEY` | token signing keys (min 32 chars) | placeholder |
   | `SECRET_KEY` / `IV` | AES envelope + auth-code crypto | placeholder |
   | `SEND_EMAIL` | `1` to actually send SMTP mail, `0` to skip | `0` |

3. **Make sure MongoDB is reachable** at `MONGODB_URI`. If it is unreachable the
   process still starts; queries fail at call time.

4. **Seed baseline data**

   ```bash
   npm run seed          # creates the Web client + SEED_USER_EMAIL / SEED_USER_PASSWORD
   ```

   Other optional seeders: `npm run seed:dummy`, `seed:mongo`, `seed:defaults`, `seed:week`.

### Windows note

`npm run build` uses POSIX `cp -r` / `mkdir -p` (via the `copyassets` script), so
it requires Git Bash or WSL on Windows. `npm run dev`, `npm run seed`, and
`npm run typecheck` work in PowerShell as-is.

## Run

```bash
npm run dev                    # ts-node + nodemon (hot reload)
# or
npm run build && npm start     # tsc -> dist/, then node dist/app.js
```

```bash
npm run typecheck              # tsc --noEmit, no output
```

Server listens on `PORT` (default `3000`). `GET /` renders a status page.

## npm scripts

| Script | Command | Purpose |
|---|---|---|
| `npm run dev` | `nodemon` | ts-node dev server with hot reload |
| `npm run build` | `tsc && npm run copyassets` | compile to `dist/`, copy `views/`, make `dist/public` |
| `npm start` | `node dist/app.js` | run the compiled build |
| `npm run typecheck` | `tsc --noEmit` | type-check only |
| `npm run seed` | `ts-node src/scripts/seed.ts` | seed `Web` client + seed user |
| `npm run seed:dummy` | `ts-node src/scripts/seed_dummy_data.ts` | dummy data |
| `npm run seed:mongo` | `ts-node src/scripts/seed_mongo.ts` | mongo seed |
| `npm run seed:defaults` | `ts-node src/scripts/seed_defaults.ts` | default records |
| `npm run seed:week` | `ts-node src/scripts/seed_week.ts` | one week of data |

Runtime deps: `express`, `mongoose`, `jsonwebtoken`, `bcryptjs`, `express-validator`,
`helmet`, `cors`, `cookie-parser`, `dotenv`, `ejs`, `morgan`, `winston`,
`winston-daily-rotate-file`, `nodemailer`, `moment-timezone`, `multiparty`, `uuid`.

## AI Providers & Token Usage (`/v1/ai`)

The AI intelligence section supports a **Groq / Ollama / Gemini switch** rendered as
**tabs**, with **used tokens per sliding 5-hour window** shown on each tab.

| Endpoint | Body/Query | Result |
| --- | --- | --- |
| `GET /v1/ai/providers` | — | Tab catalog (gemini, groq, deepseek, ollama) with `configured`, `is_active`, `model`, per-tab `token_usage_5h` and the provider's `last_usage` |
| `POST /v1/ai/providers/switch` | `{ provider: 'gemini' \| 'groq' \| 'deepseek' \| 'ollama', model: string }` | Validates and switches the active provider and UI-selected model at runtime |
| `GET /v1/ai/token-usage` | `?provider=groq&project_id=...&window_ms=...` | Used tokens per 5-hour window, split by provider tabs with a combined `total` |
| `GET /v1/ai/models` | — | Model ids of the **active** provider. If the vendor's model-list API fails (bad key, offline Ollama, rate limit) it falls back to a static per-provider catalog instead of erroring, so the settings UI always renders |

Behavior:

Updated connection behavior is documented in [AI connections](docs/ai-connections.md).
Model lists now report upstream errors instead of static fallback catalogs.
Provider switching validates readiness, and chat provider/model overrides are request-local.

- Every AI call (chat, analyze, summary, insights, recommendations, report, plan,
  risk prediction, project context) records its tokens in the `ai_token_usage`
  collection via a shared metering funnel (`_generate` → `_recordTokenUsage`).
- Providers report **real usage counts** where the vendor returns them
  (Groq `usage`, Gemini `usageMetadata`) and fall back to estimation otherwise.
- Ollama is always selectable (local server) — other tabs require
  `GROQ_API_KEY` / `GEMINI_API_KEY`.
- `POST /v1/ai/chat` accepts an optional `provider` field to switch and use a
  specific tab for that single request.
- The 5-hour window is configurable via `AI_USAGE_WINDOW_MS` (default `18000000`).

## Integrations & Repo Categories (`/v1/integrations`, `/v1/git_intelligence`)

A project can link **multiple repositories**; each repo is tagged with a
**category** picked from a dropdown in the UI ("this repo is for ..."),
so one project can track its UI team, backend and apps repos separately.

| Endpoint | Body/Query | Result |
| --- | --- | --- |
| `GET /v1/git_intelligence/categories` | — | Dropdown catalog: `{ categories: [{ value, label, color, description }], default }` |
| `POST /v1/integrations` | `{ provider, repository_name, project_id, token?, category? }` | Connects a repo to a project with its team/purpose (`category: ui \| backend \| apps \| shared \| other`) |
| `PUT /v1/integrations/:id` | `{ category?, ... }` | Re-tag the repo; returns the fresh integration document |
| `POST /v1/git_intelligence` | `{ repository_id, provider, project_id?, category? }` | Manual repo registration with a category |
| `PUT /v1/git_intelligence/:id` | `{ category?, ... }` | Re-tag a repo; also updates the linked integration's category so the next sync keeps it |
| `GET /v1/projects/:projectId/repositories` | — | Project repos with `category` each, plus `by_category` counts and the `categories` catalog |
| `GET /v1/projects/:projectId/integrations` | — | Project integrations with `category` each, plus `by_category` counts and the `categories` catalog — so the add-repo dropdown options are always available where the form renders |

Behavior:

- Categories are validated server-side — anything outside the allowed list is
  rejected with `400` and the value list; omitted values default to `other`.
- The category chosen at connect time is **propagated to the `git_intelligence`
  repo row on every sync** (the integration is the source of truth).
- Re-tagging a repo directly (`PUT /v1/git_intelligence/:id`) syncs back to the
  linked integration, so the two never drift apart.
- Re-connecting a previously deleted repo/integration **revives** the existing
  row (with the new category) instead of failing with "already exists".
- Pre-existing rows without a category read as `other` until re-tagged.

## GitHub sync

Source snapshots, incremental commit checkpoints, and plan implementation
analysis are described in [GitHub source sync](docs/github-source-sync.md).
Frontend implementation details are in [UI GitHub integration](uigit.md).

`POST /v1/integrations/:id/sync` syncs one integration.
`POST /v1/projects/:projectId/sync` syncs every integration attached to a project.
Both endpoints require `Authorization: Bearer <access_token>`. GitHub-specific
project context/analysis endpoints and project risk-analysis/deadline-prediction
endpoints additionally require an active project owner or member.

GitHub sync paginates commits from the branch explicitly supplied and saved during integration, plus all pull requests. A missing stored branch fails clearly; sync never falls back to the repository default branch.
Records are matched by project, repository, and commit SHA or PR number, keeping
repositories independent. Each GitHub request has a 30-second timeout, and commit
statistics requests run with concurrency limited to five.

When commit statistics cannot be fetched, existing values are preserved and the
sync returns `response.dataset.status: partial` with a warning. A project sync
returns `success`, `partial`, or `failed` in its dataset; when every integration
fails, it returns HTTP 400 with the per-integration results retained. Consumers
should inspect dataset status as well as HTTP status.

Run `npm run verify:git-sync` for regression checks using mocked GitHub and database
responses. The checks do not load `.env`, contact external services, or change
database records. After upgrading, re-sync affected repositories to restore
records previously overwritten by cross-repository collisions. Existing logs
are not modified; rotate any access tokens exposed by the old logging code.

## Auth API (`POST` only, mounted at `/v1/user`)

## Auth API (`POST` only, mounted at `/v1/user`)

| Endpoint | Body | Result |
|---|---|---|
| `/login` | `email, password, login_type(1), browser{id,name,version}` | `{ authorization_code, redirect_url }` |
| `/generateToken` | `authorization_code` | `{ access_token, refresh_token, refresh_token_expire_timestamp }` |
| `/regenerateToken` | `access_token, refresh_token` | new token pair (401 if refresh expired/invalid) |
| `/forgotPassword` | `email` | sends OTP email (OTP echoed in `dataset.otp` when `NODE_ENV != production`) |
| `/verifyOtp` | `email, otp` | `{ verified: true }` |
| `/resetPassword` | `email, password, confirm_password` | `{ reset: true }` |

Any non-POST verb on these routes returns `405` in the standard envelope.
