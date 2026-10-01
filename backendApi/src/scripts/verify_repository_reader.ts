import assert from 'node:assert/strict';
import { RepositoryReader, investigateRepository } from '../domain/ai_intelligence/service/repository_reader';

async function main() {
  const scope = { projectId: 'p', repositoryId: 'r', branch: 'main', repository: 'org/repo', runId: 'one', commit: 'abc' };
  const queries: any[] = [];
  const db = { collection: (name: string) => ({
    findOne: async (query: any) => {
      queries.push(query);
      if (query.path === 'binary') return { encoding: 'base64', fileType: 'blob', path: 'binary' };
      return { path: query.path, encoding: 'utf8', fileType: 'blob', fileSize: 15000, content: 'x'.repeat(15000) };
    },
    find: (query: any) => {
      queries.push(query);
      const cursor: any = { project: () => cursor, sort: () => cursor, skip: () => cursor, limit: () => cursor, maxTimeMS: () => cursor,
        toArray: async () => Array.from({ length: 51 }, (_, i) => ({ path: `${i}.ts` })) };
      return cursor;
    },
  }) };
  const reader: any = new RepositoryReader(db);
  reader.scopes = async (project: string) => project === 'p' ? [scope] : [];
  await assert.rejects(reader.execute('other', { tool: 'read', repositoryId: 'r', branch: 'main', path: 'a' }), /unavailable/);
  await assert.rejects(reader.execute('p', { tool: 'read', repositoryId: 'r', branch: 'main', path: '.env' }), /Credential/);
  const request = { repositoryId: 'r', branch: 'main' };
  const listed = await reader.execute('p', { ...request, tool: 'list' });
  assert.equal(listed.files.length, 50);
  assert.equal(listed.nextOffset, 50);
  await reader.execute('p', { ...request, tool: 'search', query: 'a.*' });
  assert.equal(queries.at(-1).$or[0].path.$regex, 'a\\.\\*');
  const read = await reader.execute('p', { ...request, tool: 'read', path: 'src/a.ts' });
  assert.equal(read.content.length, 12000);
  assert.equal(read.nextOffset, 12000);
  assert.equal(read.commit, 'abc');
  const tail = await reader.execute('p', { ...request, tool: 'read', path: 'src/a.ts', offset: 12000 });
  assert.equal(tail.content.length, 3000);
  assert.equal(tail.nextOffset, null);
  assert.equal((await reader.execute('p', { ...request, tool: 'read', path: 'binary' })).content, undefined);
  assert.ok(queries.every(query => query.projectId === 'p'));
  let calls = 0;
  const evidence = await investigateRepository('Explain authentication', 'p', async () => {
    calls++;
    return JSON.stringify(calls === 1 ? { ...request, tool: 'read', path: 'src/a.ts' } : { tool: 'done' });
  }, reader);
  assert.equal(calls, 2);
  assert.match(evidence, /src\/a.ts/);
  calls = 0;
  await investigateRepository('Inspect', 'p', async () => { calls++; return JSON.stringify({ ...request, tool: 'list' }); }, reader);
  assert.equal(calls, 3);
  assert.match(await investigateRepository('Inspect', 'other', async () => { throw new Error('must not generate'); }, reader), /No successfully synced/);
  console.log('PASS: project isolation, credential exclusion, literal search, paging, binary handling, and bounded investigation.');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
