import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { IntegrationService } from '../domain/integration/service/integration_service';
import { ProjectService } from '../domain/project/service/project_service';
import { requireSyncAccess } from '../helper/sync_access_middleware';
import { common_middleware } from '../helper/common_middleware';

async function main(): Promise<void> {
  const records = new Map<string, any>();
  const history: any[] = [];
  const requests: string[] = [];
  const logs: string[] = [];
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const projectId = '111111111111111111111111';
  let repository = 'first';
  let failStats = false;
  let failList = false;
  let active = 0;
  let peak = 0;
  const service: any = Object.create(IntegrationService.prototype);
  service._integrationModel = {
    findByAny: async () => ({ project_id: projectId, provider: 'github', repository_name: `owner/${repository}`, token: 'test-secret-token', category: 'backend', branch: 'development' }),
    updateAnyRecord: async () => ({}),
  };
  service._aiService = { rebuildProjectContext: async () => ({ status: true }) };
  service.refreshDerivedData = async () => undefined;
  service._sourceSync = { sync: async () => ({ status: 'success' }) };
  const db: any = {
    collection: (name: string) => ({
      findOneAndUpdate: async (filter: any, update: any) => {
        assert.equal(name, 'git_intelligence');
        assert.equal(Object.keys(update.$set).some(key => key in update.$setOnInsert), false);
        return { _id: filter.name };
      },
      bulkWrite: async (operations: any[]) => {
        for (const { updateOne } of operations) {
          const key = `${name}:${JSON.stringify(updateOne.filter)}`;
          records.set(key, { ...records.get(key), ...updateOne.update.$set });
        }
      },
      insertOne: async (row: any) => { history.push(row); },
    }),
  };
  (global as any).db = { connection: { db } };
  (global as any).logs = { writelog: (...values: any[]) => logs.push(JSON.stringify(values)) };
  (global as any).Helpers = {
    makeSuccessServiceStatus: (message: string, data: any) => ({ status: true, status_message: message, data_sets: data }),
    makeBadServiceStatus: (message: string) => ({ status: false, status_message: message }),
    unauthorizedStatusBuild: (res: any) => res.status(401).json({}),
  };
  console.log = (...values: any[]) => { logs.push(JSON.stringify(values)); };
  globalThis.fetch = (async (input: any, options: any) => {
    const url = new URL(input);
    requests.push(url.pathname + url.search);
    assert.ok(options.signal);
    const detail = url.pathname.match(/\/commits\/(.+)$/);
    if (detail) {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active -= 1;
      if (failStats && detail[1] === 'sha-0') return { ok: false, status: 403 };
      return { ok: true, json: async () => ({ stats: { additions: 12, deletions: 3 }, files: [{}] }) };
    }
    if (failList) return { ok: false, status: 401 };
    const page = Number(url.searchParams.get('page'));
    const offset = (page - 1) * 100;
    const rows = Array.from({ length: page === 1 ? 100 : page === 2 ? 1 : 0 }, (_, index) => {
      const position = offset + index;
      return url.pathname.endsWith('/commits')
        ? { sha: `sha-${position}`, commit: { author: { date: '2026-09-01T00:00:00Z' } } }
        : { number: position + 1, state: 'open', created_at: '2026-09-01T00:00:00Z' };
    });
    return { ok: true, json: async () => rows };
  }) as any;
  try {
    const first = await service.syncIntegration('integration-1');
    assert.equal(first.data_sets.status, 'success');
    assert.equal(first.data_sets.items_synced.total, 202);
    assert.equal(records.size, 202);
    assert.ok(peak <= 5);
    assert.ok(requests.some(request => request.includes('/pulls?') && request.includes('page=2')));
    assert.ok(requests.some(request => request.includes('/commits?sha=development')));
    failStats = true;
    const partial = await service.syncIntegration('integration-1');
    assert.equal(partial.data_sets.status, 'partial');
    assert.equal(records.size, 202);
    const firstCommit = [...records.values()].find(row => row.sha === 'sha-0');
    assert.equal(firstCommit.additions, 12);
    assert.equal(history[history.length - 1].status, 'partial');
    repository = 'second';
    failStats = false;
    await service.syncIntegration('integration-2');
    assert.equal(records.size, 404);
    assert.equal([...records.values()].filter(row => row.number === 1).length, 2);
    failList = true;
    const failed = await service.syncIntegration('integration-2');
    assert.equal(failed.status, false);
    assert.equal(history[history.length - 1].status, 'failed');
    assert.equal(logs.some(log => log.includes('test-secret-token')), false);

    const projectService: any = Object.create(ProjectService.prototype);
    projectService._projectModel = { findByAny: async () => ({}) };
    db.collection = () => ({ find: () => ({ toArray: async () => [{ _id: 'first' }, { _id: 'second' }] }) });
    projectService._integrationService = { syncIntegration: async () => ({ status: false, status_message: 'Failed' }) };
    const failedProject = await projectService.syncProject(projectId);
    assert.equal(failedProject.status, false);
    assert.equal(failedProject.data_sets.status, 'failed');
    projectService._integrationService = { syncIntegration: async (id: string) => ({ status: id === 'first', data_sets: { status: 'success' } }) };
    assert.equal((await projectService.syncProject(projectId)).data_sets.status, 'partial');

    let responseStatus = 0;
    let allowed = false;
    const response: any = { status: (status: number) => { responseStatus = status; return response; }, json: () => {} };
    new common_middleware().validateToken({ headers: {} } as any, response, () => { allowed = true; });
    assert.equal(responseStatus, 401);
    assert.equal(allowed, false);
    const userId = '222222222222222222222222';
    let isOwner = false;
    let isMember = false;
    let isActive = true;
    let projectDeleted = false;
    db.collection = (name: string) => ({ findOne: async () => {
      if (name === 'users') return { _id: new mongoose.Types.ObjectId(userId), is_active: isActive };
      if (name === 'projects') return { owner_id: isOwner ? userId : 'someone-else', is_deleted: projectDeleted };
      if (name === 'project_members') return isMember ? { user_id: userId } : null;
      return { project_id: projectId };
    } });
    const request: any = { params: { projectId }, body: { loginDetails: { verifiedData: { user_id: userId } } } };
    responseStatus = 0;
    await requireSyncAccess(request, response, () => { allowed = true; });
    assert.equal(responseStatus, 0);
    assert.equal(allowed, true);
    allowed = false;
    isOwner = true;
    await requireSyncAccess(request, response, () => { allowed = true; });
    assert.equal(allowed, true);
    allowed = false;
    isActive = false;
    await requireSyncAccess(request, response, () => { allowed = true; });
    assert.equal(responseStatus, 403);
    assert.equal(allowed, false);
    isActive = true;
    projectDeleted = true;
    await requireSyncAccess(request, response, () => { allowed = true; });
    assert.equal(responseStatus, 404);
    assert.equal(allowed, false);
    allowed = false;
    isOwner = false;
    isMember = true;
    projectDeleted = false;
    request.params = { id: '333333333333333333333333' };
    await requireSyncAccess(request, response, () => { allowed = true; });
    assert.equal(allowed, true);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
  console.log('Git sync regression checks passed (mock GitHub and database).');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
