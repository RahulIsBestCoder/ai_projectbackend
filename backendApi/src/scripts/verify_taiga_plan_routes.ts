/**
 * Wiring check for the plan-scoped Taiga publish routes ("Create in Taiga" button).
 *
 * Asserts that the four plan-scoped routes are registered on BOTH mounts
 * (`/v1/plans/*` and `/v1/ai/plans/*`) and reachable: a request without a bearer
 * token must answer 401 (route matched + `validateToken` ran), never 404.
 *
 * No MongoDB connection is needed — the domain models only require the mongoose
 * instance behind the `global.db` service locator.
 *
 * `--transpile-only` is required: importing the whole app pulls in modules that
 * ts-node's type-checker rejects although `npm run typecheck` (tsc) passes.
 *
 * Run: npm run verify:taiga-routes
 */
const mongoose = require('mongoose');
const express = require('express');

(global as any).db = mongoose;
(global as any).logs = { writelog: () => { /* silent */ } };

const { common_helper } = require('../helper/common_helper');
(global as any).Helpers = new common_helper();

const { createTaigaPlanRoutes } = require('../domain/integration/route/taiga_plan_route');
const appRoute = require('../app_routing').default;

/** `${METHOD} ${path}` for every route registered directly on a router. */
const listRoutes = (router: any): string[] => {
  const out: string[] = [];
  for (const layer of router.stack || []) {
    if (!layer.route) continue;
    const methods = Object.keys(layer.route.methods || {}).filter((m) => layer.route.methods[m]);
    for (const m of methods) out.push(`${m.toUpperCase()} ${layer.route.path}`);
  }
  return out;
};

/** Number of handlers attached to each route (auth + plan validation + controller). */
const handlerCounts = (router: any): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const layer of router.stack || []) {
    if (!layer.route) continue;
    const methods = Object.keys(layer.route.methods || {}).filter((m) => layer.route.methods[m]);
    for (const m of methods) out[`${m.toUpperCase()} ${layer.route.path}`] = layer.route.stack.length;
  }
  return out;
};

const EXPECTED = [
  'POST /:planId/create-in-taiga',
  'POST /:planId/create-in-taiga/preview',
  'GET /:planId/taiga-sync',
  'POST /:planId/taiga-sync/retry',
];

const PLAN_ID = '000000000000000000000000';
const PROJECT_ID = '111111111111111111111111';
const MOUNTED = [
  `/v1/plans/${PLAN_ID}/create-in-taiga`,
  `/v1/plans/${PLAN_ID}/create-in-taiga/preview`,
  `/v1/plans/${PLAN_ID}/taiga-sync`,
  `/v1/plans/${PLAN_ID}/taiga-sync/retry`,
  `/v1/ai/plans/${PLAN_ID}/create-in-taiga`,
  `/v1/ai/plans/${PLAN_ID}/create-in-taiga/preview`,
  `/v1/ai/plans/${PLAN_ID}/taiga-sync`,
  `/v1/ai/plans/${PLAN_ID}/taiga-sync/retry`,
];

/** Project-scoped aliases — consolidated into `integration/route/taiga_route.ts`. */
const MOUNTED_PROJECT = [
  `/v1/projects/${PROJECT_ID}/taiga/status`,
  `/v1/projects/${PROJECT_ID}/plans/${PLAN_ID}/publish-to-taiga`,
  `/v1/projects/${PROJECT_ID}/plans/${PLAN_ID}/publish-to-taiga/preview`,
  `/v1/projects/${PROJECT_ID}/plans/${PLAN_ID}/create-in-taiga`,
];

const isGet = (path: string): boolean =>
  path.includes('taiga-sync') && !path.endsWith('retry') || path.endsWith('/taiga/status');

async function main(): Promise<void> {
  let failures = 0;
  const check = (ok: boolean, label: string, detail = ''): void => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };

  // 1. Isolated router: paths and middleware chain length.
  const router = createTaigaPlanRoutes();
  const routes = listRoutes(router);
  const counts = handlerCounts(router);
  for (const expected of EXPECTED) {
    check(routes.includes(expected), `route registered: ${expected}`);
    check((counts[expected] || 0) === 3, `route guarded (auth + plan validation + controller): ${expected}`, `handlers=${counts[expected] || 0}`);
  }
  check(routes.length === EXPECTED.length, 'no unexpected plan-scoped routes', `count=${routes.length}`);

  // An authenticated caller needs a valid plan, but no owner/member record.
  const originalDb = mongoose.connection.db;
  let planExists = true;
  mongoose.connection.db = {
    collection: (name: string) => {
      if (name !== 'ai_plans') throw new Error(`Unexpected permission lookup: ${name}`);
      return { findOne: async () => planExists ? { _id: PLAN_ID, project_id: PROJECT_ID } : null };
    },
  };
  try {
    for (const layer of router.stack.filter((item: any) => item.route)) {
      const validatePlan = layer.route.stack[1].handle;
      let nextCalled = false;
      let status = 200;
      const response = { status: (code: number) => { status = code; return response; }, json: () => response };
      const request = { params: { planId: PLAN_ID }, body: { loginDetails: { verifiedData: { user_id: 'non-member' } } } };
      await validatePlan(request, response, () => { nextCalled = true; });
      check(nextCalled && status === 200, `non-member may publish/read: ${layer.route.path}`);
      planExists = false;
      await validatePlan(request, response, () => {});
      check(status === 404, `missing plan rejected: ${layer.route.path}`);
      planExists = true;
      request.params.planId = 'invalid';
      await validatePlan(request, response, () => {});
      check(status === 400, `invalid plan rejected: ${layer.route.path}`);
    }
  } finally { mongoose.connection.db = originalDb; }

  // 2. Mounted app: each path must answer 401 (matched + guarded), not 404.
  const app = express();
  app.use(express.json());
  app.use('/v1', appRoute);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = (server.address() as any).port;
  for (const path of MOUNTED) {
    const method = isGet(path) ? 'GET' : 'POST';
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? '{}' : undefined,
    });
    check(res.status === 401, `mounted & guarded: ${method} ${path}`, `status=${res.status}`);
  }
  // 3. Project-scoped aliases: same expectation (401 = matched + guarded, not 404).
  for (const path of MOUNTED_PROJECT) {
    const method = isGet(path) ? 'GET' : 'POST';
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? '{}' : undefined,
    });
    check(res.status === 401, `project alias mounted & guarded: ${method} ${path}`, `status=${res.status}`);
  }
  server.close();

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: any) => { console.error('ERR:', err?.message || err); process.exit(1); });
