import assert from 'node:assert/strict';
import { GitHubSourceSyncService } from '../domain/integration/service/github_source_sync_service';
import { GitHubCodeContextService } from '../domain/ai_intelligence/service/github_code_context_service';

class MemoryDatabase {
  public rows = new Map<string, any[]>();
  public failCollection = '';

  private matches(row: any, filter: any): boolean {
    return Object.entries(filter).every(([key, value]: any) => {
      if (key === '$or') return value.some((condition: any) => this.matches(row, condition));
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('$exists' in value) return (row[key] !== undefined) === value.$exists;
        if ('$lt' in value) return row[key] < value.$lt;
        if ('$in' in value) return value.$in.includes(row[key]);
      }
      return row[key] === value;
    });
  }

  public collection(name: string): any {
    if (!this.rows.has(name)) this.rows.set(name, []);
    const rows = this.rows.get(name)!;
    const update = async (filter: any, patch: any, options: any = {}) => {
      if (this.failCollection === name) throw new Error('Injected database failure');
      let row = rows.find(candidate => this.matches(candidate, filter));
      const matchedCount = row ? 1 : 0;
      if (!row && options.upsert) {
        row = { ...filter, ...patch.$setOnInsert, _id: `${name}-${rows.length}` };
        rows.push(row);
      }
      if (row) {
        Object.assign(row, patch.$set);
        for (const key of Object.keys(patch.$unset || {})) delete row[key];
      }
      return { matchedCount };
    };
    return {
      createIndex: async () => 'index',
      updateOne: update,
      findOneAndUpdate: async (filter: any, patch: any) => {
        const row = rows.find(candidate => this.matches(candidate, filter));
        if (!row) return null;
        await update(filter, patch);
        return { ...row };
      },
      insertOne: async (row: any) => { rows.push({ ...row, _id: row._id || `${name}-${String(rows.length).padStart(8, '0')}` }); },
      findOne: async (filter: any, options: any = {}) => {
        const selected = rows.filter(row => this.matches(row, filter));
        if (options.sort) {
          selected.sort((first, second) => {
            for (const [key, direction] of Object.entries(options.sort) as any) {
              if (first[key] < second[key]) return -direction;
              if (first[key] > second[key]) return direction;
            }
            return 0;
          });
        }
        return selected[0] ? { ...selected[0] } : null;
      },
      find: (filter: any) => {
        let limit = Infinity;
        const cursor: any = { project: () => cursor, sort: () => cursor,
          limit: (value: number) => { limit = value; return cursor; },
          toArray: async () => rows.filter(row => this.matches(row, filter)).slice(0, limit).map(row => ({ ...row })) };
        return cursor;
      },
      countDocuments: async (filter: any) => rows.filter(row => this.matches(row, filter)).length,
      aggregate: (pipeline: any[]) => ({ toArray: async () => rows.filter(row => this.matches(row, pipeline[0].$match))
        .slice(0, pipeline.find(stage => stage.$limit)?.$limit || rows.length)
        .map(row => ({ ...row, content: row.content.slice(0, 6000), contentLength: row.content.length })) }),
      deleteMany: async (filter: any) => {
        for (let index = rows.length - 1; index >= 0; index -= 1) if (this.matches(rows[index], filter)) rows.splice(index, 1);
      },
      bulkWrite: async (operations: any[]) => {
        for (const { updateOne } of operations) await update(updateOne.filter, updateOne.update, { upsert: updateOne.upsert });
      },
    };
  }
}

async function main(): Promise<void> {
  const database = new MemoryDatabase();
  const service = new GitHubSourceSyncService(database);
  const input = { projectId: 'project-1', integrationId: 'integration-1', branch: 'development' };
  let head = 'head-1';
  let headNumber = 1;
  let repositoryId = 123;
  let comparison: any = { status: 'ahead', ahead_by: 1, behind_by: 0, files: [] };
  let truncated = false;
  let failBlob = false;
  let missingBase = false;
  const paths: string[] = [];
  const blobs: any = { file1: 'export function first() { return true; }', file2: 'export function second() { return true; }' };
  let tree: any[] = [
    { path: 'domain/payment/service.ts', type: 'blob', mode: '100644', sha: 'file1' },
  ];
  const request = async (path: string): Promise<any> => {
    paths.push(path);
    if (path === '') return { id: repositoryId, name: 'backend', full_name: 'owner/backend', owner: { login: 'owner' }, default_branch: 'main', private: true };
    if (path.startsWith('/branches/')) return { commit: { sha: head } };
    if (path.startsWith('/commits/')) return { sha: head, commit: { message: head, tree: { sha: `tree-${head}` }, author: { date: `2026-09-${String(headNumber).padStart(2, '0')}T00:00:00Z` } } };
    if (path.startsWith('/compare/')) {
      if (missingBase) throw Object.assign(new Error('Base commit unavailable'), { statusCode: 404 });
      return comparison;
    }
    if (path.startsWith('/git/trees/')) {
      if (truncated && path.endsWith('?recursive=1')) return { truncated: true, tree: [] };
      if (truncated && path.includes('domain-subtree')) return { tree: [{ path: 'payment/service.ts', type: 'blob', mode: '100644', sha: 'file1' }] };
      if (truncated) return { tree: [{ path: 'domain', type: 'tree', sha: 'domain-subtree' }] };
      return { truncated: false, tree };
    }
    if (path.startsWith('/git/blobs/')) {
      if (failBlob) throw new Error('Injected GitHub blob failure');
      const sha = path.split('/').pop()!;
      assert.ok(blobs[sha], `Unexpected blob download: ${sha}`);
      return { sha, encoding: 'base64', content: Buffer.from(blobs[sha]).toString('base64') };
    }
    throw new Error(`Unexpected GitHub request: ${path}`);
  };
  const snapshot = () => database.rows.get('github_source_files')!;
  const setHead = (value: number) => { headNumber = value; head = `head-${value}`; };
  const initial = await service.sync(input, request);
  assert.equal(initial.mode, 'initial');
  assert.equal(initial.filesAdded, 1);
  assert.equal(snapshot().length, 1);
  assert.equal(snapshot()[0].content, blobs.file1);
  assert.equal(snapshot()[0].encoding, 'utf8');
  paths.length = 0;
  assert.equal((await service.sync(input, request)).mode, 'no_changes');
  assert.equal(paths.some(path => /compare|trees|blobs/.test(path)), false);
  setHead(2);
  comparison.files = [
    { filename: 'domain/payment/new.ts', previous_filename: 'domain/payment/service.ts', status: 'renamed', sha: 'file2' },
  ];
  const renamed = await service.sync(input, request);
  assert.equal(renamed.mode, 'incremental');
  assert.deepEqual(snapshot().map(row => row.path), ['domain/payment/new.ts']);
  assert.equal(snapshot()[0].content, blobs.file2);
  setHead(3);
  comparison.files = [{ filename: 'domain/payment/new.ts', status: 'removed' }];
  await service.sync(input, request);
  assert.equal(snapshot().length, 0);
  setHead(4);
  comparison.files = [{ filename: 'domain/payment/added.ts', status: 'added', sha: 'file1' }];
  failBlob = true;
  await assert.rejects(service.sync(input, request), /blob failure/);
  assert.equal((await service.status(input.projectId))[0].lastSyncedCommitSha, 'head-3');
  assert.equal(snapshot().length, 0);
  failBlob = false;
  tree = [{ path: 'domain/payment/added.ts', type: 'blob', mode: '100644', sha: 'file1' }];
  await service.sync(input, request);
  assert.equal(snapshot().length, 1);
  assert.equal((await service.status(input.projectId))[0].lastSyncedCommitSha, 'head-4');
  setHead(5);
  comparison.files = [{ filename: 'domain/payment/added.ts', status: 'removed' }];
  await service.sync(input, request);
  assert.equal(snapshot().length, 0);
  setHead(6);
  tree = [{ path: 'domain/payment/service.ts', type: 'blob', mode: '100644', sha: 'file1' }];
  comparison = { status: 'diverged', files: [] };
  assert.equal((await service.sync(input, request)).mode, 'reconcile');
  assert.equal(snapshot()[0].path, 'domain/payment/service.ts');
  setHead(7);
  comparison = { status: 'ahead', files: Array.from({ length: 300 }, (_, index) => ({ filename: `outside/${index}`, status: 'modified' })) };
  tree = [{ path: 'domain/payment/service.ts', type: 'blob', mode: '100644', sha: 'file2' }];
  assert.equal((await service.sync(input, request)).mode, 'reconcile');
  assert.equal(snapshot()[0].content, blobs.file2);
  setHead(8);
  comparison = { status: 'diverged', files: [] };
  truncated = true;
  await service.sync(input, request);
  assert.equal(snapshot()[0].content, blobs.file1);
  assert.ok(paths.some(path => path === '/git/trees/domain-subtree'));
  truncated = false;
  setHead(9);
  comparison = { status: 'ahead', files: [{ filename: 'domain/payment/service.ts', status: 'modified', sha: 'file2' }] };
  database.failCollection = 'github_file_changes';
  await assert.rejects(service.sync(input, request), /database failure/);
  assert.equal(snapshot()[0].content, blobs.file2);
  assert.equal((await service.status(input.projectId))[0].lastSyncedCommitSha, 'head-8');
  database.failCollection = '';
  setHead(8);
  tree = [{ path: 'domain/payment/service.ts', type: 'blob', mode: '100644', sha: 'file1' }];
  assert.equal((await service.sync(input, request)).mode, 'reconcile');
  assert.equal(snapshot()[0].content, blobs.file1);
  setHead(9);
  comparison = { status: 'ahead', files: [{ filename: 'domain/payment/service.ts', status: 'modified', sha: 'file2' }] };
  database.failCollection = 'github_file_changes';
  await assert.rejects(service.sync(input, request), /database failure/);
  database.failCollection = '';
  setHead(10);
  comparison = { status: 'ahead', files: [] };
  assert.equal((await service.sync(input, request)).mode, 'reconcile');
  assert.equal(snapshot()[0].content, blobs.file1);
  const repository = database.rows.get('github_repositories')![0];
  repository.lockUntil = new Date(Date.now() + 60000);
  repository.lockToken = 'another-worker';
  await assert.rejects(service.sync(input, request), /already in progress/);
  delete repository.lockUntil;
  delete repository.lockToken;
  repositoryId = 456;
  await service.sync({ ...input, integrationId: 'integration-2' }, request);
  assert.equal(snapshot().length, 2);
  assert.notEqual(snapshot()[0].repositoryId, snapshot()[1].repositoryId);
  setHead(11);
  missingBase = true;
  assert.equal((await service.sync({ ...input, integrationId: 'integration-2' }, request)).mode, 'reconcile');
  missingBase = false;
  setHead(12);
  comparison = { status: 'ahead', files: [{ filename: 'domain/payment/binary.ts', status: 'added', sha: 'binary' }] };
  blobs.binary = 'binary\u0000data';
  await service.sync({ ...input, integrationId: 'integration-2' }, request);
  const secondStatus = (await service.status(input.projectId)).find(row => row.repositoryId === '456');
  assert.equal(secondStatus.lastSyncedCommitSha, 'head-12');
  assert.equal(snapshot().find(row => row.path.endsWith('binary.ts')).encoding, 'base64');
  comparison.files = [{ filename: 'domain/payment/large.ts', status: 'added', sha: 'file1', size: 3 * 1024 * 1024 }];
  tree = [{ path: 'domain/payment/large.ts', type: 'blob', mode: '100644', sha: 'file1', size: 3 * 1024 * 1024 }];
  setHead(13);
  failBlob = true;
  await assert.rejects(service.sync({ ...input, integrationId: 'integration-2' }, request), /blob failure/);
  failBlob = false;

  const builder = new GitHubCodeContextService(database);
  await database.collection('integrations').insertOne({ _id: 'integration-1', project_id: input.projectId, provider: 'github', is_deleted: false });
  await database.collection('integrations').insertOne({ _id: 'integration-2', project_id: input.projectId, provider: 'github', is_deleted: false });
  const builtContext = await builder.build(input.projectId);
  assert.equal(builtContext.files.length, 1);
  assert.equal(builtContext.files[0].repositoryId, '123');
  assert.equal(builtContext.coverage.incomplete, true);
  assert.equal(builtContext.repositories.find((row: any) => row.repositoryId === '456').status, 'failed');
  const context = { files: [{ evidenceId: 'file', content: blobs.file1 }], coverage: { incomplete: false }, repositories: [] };
  const tasks = [{ id: 'one', weight: 2 }, { id: 'two', weight: 1 }];
  const analysis = builder.normalizeAnalysis(tasks, { items: [
    { id: 'one', status: 'IMPLEMENTED', evidence: [{ evidenceId: 'file', quote: blobs.file1 }] },
    { id: 'two', status: 'IMPLEMENTED', evidence: [{ evidenceId: 'invented', quote: 'fake implementation' }] },
  ] }, context);
  assert.equal(analysis.progressPercent, 67);
  assert.equal(analysis.items[1].status, 'UNCLEAR');
  context.coverage.incomplete = true;
  const missing = builder.normalizeAnalysis(tasks, { items: [{ id: 'one', status: 'NOT_IMPLEMENTED' }] }, context);
  assert.equal(missing.items[0].status, 'UNCLEAR');
  // A legacy successful checkpoint must rebuild at the same HEAD to pick up
  // the newly supported source root.
  repositoryId = 999;
  truncated = false;
  failBlob = false;
  missingBase = false;
  tree = [{ path: 'src/domain/auth/service.ts', type: 'blob', mode: '100644', sha: 'file1' }];
  await service.sync(input, request);
  const legacy = database.rows.get('github_syncs')!.filter((row: any) => row.repositoryId === '999' && row.status === 'success');
  for (const row of legacy) delete row.sourceScopeVersion;
  tree.push({ path: 'src/domain/auth/model.ts', type: 'blob', mode: '100644', sha: 'file2' });
  assert.equal((await service.sync(input, request)).mode, 'reconcile');
  assert.equal(snapshot().filter((row: any) => row.repositoryId === '999').length, 2);
  assert.equal((await service.sync(input, request)).mode, 'no_changes');
  repositoryId = 1000;
  blobs.large = 'x'.repeat(5 * 1024 * 1024);
  tree = [
    { path: 'README.md', type: 'blob', mode: '100644', sha: 'file1' },
    { path: 'src/app/component.ts', type: 'blob', mode: '100644', sha: 'file2' },
    { path: 'assets/image.bin', type: 'blob', mode: '100644', sha: 'binary' },
    { path: 'data/large.txt', type: 'blob', mode: '100644', sha: 'large' },
    { path: 'link', type: 'blob', mode: '120000', sha: 'file1' },
    { path: 'vendor/module', type: 'commit', mode: '160000', sha: 'submodule-sha' },
  ];
  const allFiles = await service.sync(input, request);
  assert.equal(allFiles.filesAdded, 6);
  assert.equal(allFiles.filesIgnored, 0);
  const saved = snapshot().filter(row => row.repositoryId === '1000');
  assert.equal(saved.find(row => row.path === 'link').fileType, 'symlink');
  assert.equal(saved.find(row => row.path === 'vendor/module').fileType, 'submodule');
  assert.equal(saved.find(row => row.path === 'data/large.txt').storage, 'chunks');
  const chunks = database.rows.get('github_source_chunks')!.filter(row => row.repositoryId === '1000').sort((a, b) => a.index - b.index);
  assert.equal(Buffer.concat(chunks.map(row => Buffer.from(row.content, 'base64'))).toString('utf8'), blobs.large);
  assert.equal(Buffer.from(saved.find(row => row.path === 'assets/image.bin').content, 'base64').toString('utf8'), blobs.binary);
  console.log('GitHub source sync checks passed, including src/domain coverage and same-HEAD legacy snapshot repair.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
