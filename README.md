# HireSense Backend API

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

## Setup

```bash
npm install
cp .env.example .env          # already done; adjust as needed
# make sure MongoDB is reachable at MONGODB_URI (default mongodb://127.0.0.1:27017/)
npm run seed                  # creates the Web client + admin@hiresense.local / Admin@123
```

## Run

```bash
npm run dev      # ts-node + nodemon
# or
npm run build && npm start    # tsc -> dist/, then node dist/app.js
```

Server listens on `PORT` (default `3000`). `GET /` renders a status page.
If MongoDB is unreachable the process still starts (queries fail at call time).

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

### Quick check

```bash
curl -s -X POST localhost:3000/v1/user/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@hiresense.local","password":"Admin@123","login_type":1,"browser":{"id":"b1","name":"chrome"}}'
```

## Notes / parity with the plan

- `common_middleware.validateToken` is implemented but auth routes deliberately omit it (plan §5.1).
- `common_middleware.checkAccessPermission` is present but latent — not wired to routes (plan §7.3).
- Transport envelope encryption is off by default (`ENCRYPTED_DATA=0`); set to `1` to enable `enc_data` wrapping.
- Email delivery is gated by `SEND_EMAIL=1`; otherwise sends are logged and skipped.
- Route modules are `require()`d after the `global` service locator is populated, so eager
  controller/service/model singletons see `global.db` (see `src/app.ts` step 9).
