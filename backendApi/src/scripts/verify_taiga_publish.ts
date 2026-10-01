/** Offline regression checks; no database or live Taiga writes. */
export {};
const assert = require('node:assert/strict');
(global as any).db = require('mongoose');
(global as any).logs = { writelog: () => {} };
const { TaigaClient } = require('../domain/integration/service/taiga_client');
const { TaigaPublishService } = require('../domain/integration/service/taiga_publish_service');

async function main() {
  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  try {
    globalThis.fetch = (async (url: string, options: any = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : undefined;
      requests.push({ path, body });
      if (path.includes('task-types')) return { ok: false, status: 404, json: async () => ({}) };
      if (options.method === 'PATCH') {
        assert.equal(body.version, 7);
        return { ok: true, json: async () => ({ id: 1 }) };
      }
      if (/\/(tasks|userstories)\/1$/.test(path)) return { ok: true, json: async () => ({ version: 7 }) };
      return { ok: true, json: async () => [] };
    }) as any;
    const client = new TaigaClient('test', 'https://example.test/api/v1/');
    await client.getMetadata(1);
    assert.equal(requests.length, 6);
    await client.updateUserStory(1, { subject: 'Story' });
    await client.updateTask(1, { subject: 'Task' });
    globalThis.fetch = (async () => ({ ok: false, status: 400, json: async () => ({ estimated_start: ['Invalid date'] }) })) as any;
    await assert.rejects(new TaigaClient('test').createMilestone(1, {}), /estimated_start.*Invalid date/);

    const service = new TaigaPublishService() as any;
    const integration = {
      repository_name: 'project/sougatabauri-demo-projetc',
      repository_url: 'https://tree.taiga.io/project/sougatabauri-demo-projetc',
      token: 'test',
    };
    let resolvedUrl = '';
    globalThis.fetch = (async (url: string) => {
      resolvedUrl = url;
      return { ok: true, json: async () => ({ id: 42 }) };
    }) as any;
    await service.resolveTaigaProject(await service.buildClient(integration), integration);
    assert.equal(resolvedUrl, 'https://api.taiga.io/api/v1/projects/by_slug?slug=sougatabauri-demo-projetc');
    assert.equal(service.parseSlug({ repository_name: integration.repository_name }), 'sougatabauri-demo-projetc');
    assert.equal(service.taigaApiBase('https://taiga.example/api/v1/'), 'https://taiga.example/api/v1');
    assert.equal(service.taigaApiBase('https://taiga.example/project/demo'), 'https://taiga.example/api/v1');
    // Status clients recover a stale stored token and persist the replacement.
    let authCalls = 0;
    let savedToken = '';
    service._integrationModel = {
      updateAnyRecord: async (_: any, update: any) => { savedToken = update.token; },
    };
    globalThis.fetch = (async (url: string, options: any) => {
      if (url.endsWith('/auth')) {
        authCalls++;
        return { ok: true, json: async () => ({ auth_token: 'fresh' }) };
      }
      if (options.headers.Authorization !== 'Bearer fresh') {
        return { ok: false, status: 401, json: async () => ({ detail: 'given token not valid for any token type' }) };
      }
      return { ok: true, json: async () => ({ id: 42 }) };
    }) as any;
    const recovering = await service.buildClient({ ...integration, _id: 'i', username: 'user', password: 'password' });
    await Promise.all([recovering.getProject(42), recovering.getProject(42)]);
    assert.equal(authCalls, 1);
    assert.equal(savedToken, 'fresh');
    await assert.rejects(service.resolveTaigaProject(await service.buildClient({ ...integration, repository_name: '42' }), { repository_name: '42' }), /Reconnect the Taiga integration/);
    let rejectedCalls = 0;
    globalThis.fetch = (async () => {
      rejectedCalls++;
      return { ok: false, status: 401, json: async () => ({ detail: 'rejected' }) };
    }) as any;
    await assert.rejects(new TaigaClient('stale', undefined, async () => 'also-invalid').getProject(42), /Taiga 401/);
    assert.equal(rejectedCalls, 2, 'Retry must be bounded');
    rejectedCalls = 0;
    globalThis.fetch = (async () => {
      rejectedCalls++;
      return { ok: false, status: 403, json: async () => ({ detail: 'forbidden' }) };
    }) as any;
    await assert.rejects(new TaigaClient('valid', undefined, async () => { throw new Error('Should not authenticate'); }).getProject(42), /Taiga 403/);
    assert.equal(rejectedCalls, 1);
    const rows: any[] = [];
    const matches = (r: any, q: any) => Object.entries(q).every(([k, v]) => r[k] === v);
    service._mappingModel = {
      findByAny: async (q: any) => rows.find(r => matches(r, q)),
      addNewRecord: async (data: any) => rows.push({ _id: rows.length + 1, ...data }),
      updateAnyRecord: async (q: any, data: any) => Object.assign(rows.find(r => matches(r, q)), data),
    };
    const sprints = [{ name: 'Sprint', planned_points: 5, start_date: '2026-09-19', end_date: '2026-09-26', tasks: [{ title: 'Task' }] }];
    let fail = true;
    let taskCreates = 0;
    const fakeClient = {
      createMilestone: async () => { if (fail) throw new Error('Temporary failure'); return { id: 10 }; },
      createUserStory: async (_: any, body: any) => {
        assert.equal(body.points, undefined);
        assert.match(body.description, /Planned points: 5/);
        assert.equal(body.milestone, 10);
        return { id: 20 };
      },
      createTask: async (_: any, body: any) => { taskCreates++; assert.equal(body.user_story, 20); return { id: 30 }; },
      updateMilestone: async () => {}, updateUserStory: async () => {}, updateTask: async () => {},
    };
    const metadata = { taskStatuses: [], userStoryStatuses: [], priorities: [], points: [] };
    let result = await service.publishSprintTree(fakeClient, 'p', 'plan', 1, sprints, metadata, [], true);
    assert.equal(result.milestones.failed, 1);
    assert.deepEqual(await service.collectExistingEntities('p', 'plan', sprints), []);
    fail = false;
    result = await service.publishSprintTree(fakeClient, 'p', 'plan', 1, sprints, metadata, [], true);
    assert.equal(result.tasks.created, 1);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].last_error, null);
    await service.publishSprintTree(fakeClient, 'p', 'plan', 1, sprints, metadata, [], true);
    assert.equal(taskCreates, 1);
    assert.equal(rows.length, 3);
    const allSprints = Array.from({ length: 23 }, (_, index) => ({
      name: `Sprint ${index + 1}`, tasks: [{ title: 'Build', assignee_role: 'backend' }, { title: 'Test', assignee_role: 'qa' }],
    }));
    rows.length = 0;
    result = await service.publishSprintTree({
      createMilestone: async () => ({ id: 10 }),
      createUserStory: async () => ({ id: 20 }),
      createTask: async (_: any, body: any) => { assert.equal(body.assigned_to, undefined); return { id: 30 }; },
    }, 'p', 'full-plan', 1, allSprints, metadata, [], true, true);
    assert.equal(result.milestones.created, 23);
    assert.equal(result.user_stories.created, 23);
    assert.equal(result.tasks.created, 46);
    assert.equal(result.tasks.failed, 0);
    assert.equal(result.warnings.length, 46);
    assert.equal(rows.length, 92);
    rows.length = 0;
    result = await service.publishSprintTree(fakeClient, 'p', 'strict-plan', 1,
      [{ ...sprints[0], tasks: [{ title: 'Build', assignee_role: 'backend' }] }], metadata, [], true, false);
    assert.equal(result.tasks.failed, 1);
    assert.equal(result.tasks.created, 0);
    (global as any).Helpers = {
      makeBadServiceStatus: (message: string) => ({ status: false, status_message: message }),
      makeSuccessServiceStatus: (message: string, data: any) => ({ status: true, data_sets: data }),
    };
    const guarded = new TaigaPublishService() as any;
    guarded._planModel = { findByAny: async () => ({ project_id: 'p', status: 'accepted', plan: { sprints } }) };
    guarded.resolveIntegration = async () => ({ provider: 'taiga' });
    guarded.resolveTaigaProject = async () => ({ id: 1 });
    let occupied = true;
    let writes = 0;
    guarded.buildClient = async () => ({
      hasSprints: async () => occupied,
      getMetadata: async () => { throw new Error('EMPTY_PROJECT_REACHED_METADATA'); },
    });
    guarded.publishSprintTree = async () => { writes++; throw new Error('Unexpected write'); };
    for (const mode of ['create', 'sync']) {
      const blocked = await guarded.createPlanInTaiga('plan', { mode });
      assert.equal(blocked.status, false);
      assert.match(blocked.status_message, /TAIGA_SPRINTS_EXIST/);
    }
    assert.match((await guarded.retryPlanSync('plan')).status_message, /TAIGA_SPRINTS_EXIST/);
    assert.match((await guarded.previewPlanByPlanId('plan')).status_message, /TAIGA_SPRINTS_EXIST/);
    assert.equal(writes, 0);
    occupied = false;
    assert.match((await guarded.createPlanInTaiga('plan')).status_message, /EMPTY_PROJECT_REACHED_METADATA/);
    globalThis.fetch = (async () => ({ ok: true, json: async () => [{ id: 99, closed: true }] })) as any;
    assert.equal(await new TaigaClient('test').hasSprints(1), true);
    globalThis.fetch = (async () => ({ ok: true, json: async () => [] })) as any;
    assert.equal(await new TaigaClient('test').hasSprints(1), false);
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ unexpected: true }) })) as any;
    await assert.rejects(new TaigaClient('test').hasSprints(1), /Unexpected Taiga sprint list/);
    console.log('PASS: metadata, versioned updates, validation errors, sprint hierarchy and retry idempotency');
  } finally { globalThis.fetch = originalFetch; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
