# Ai Project Backend API

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
