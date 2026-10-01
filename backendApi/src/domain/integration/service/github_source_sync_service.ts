import { randomUUID } from 'crypto';

export type GitHubRequest = (path: string) => Promise<any>;

export class GitHubSourceSyncService {
  constructor(private readonly database: any = global.db.connection.db) {}

  private isSource(path: unknown): path is string {
    return typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.split('/').includes('..');
  }

  private async ensureIndexes(): Promise<void> {
    await this.database.collection('github_repositories').createIndex({ projectId: 1, githubRepositoryId: 1 }, { unique: true });
    await this.database.collection('github_source_files').createIndex({ projectId: 1, repositoryId: 1, branch: 1, path: 1 }, { unique: true });
    await this.database.collection('github_source_chunks').createIndex({ projectId: 1, repositoryId: 1, branch: 1, fileSha: 1, index: 1 }, { unique: true });
    await this.database.collection('github_file_changes').createIndex({ projectId: 1, repositoryId: 1, branch: 1, commitSha: 1, path: 1 }, { unique: true });
    await this.database.collection('github_syncs').createIndex({ projectId: 1, repositoryId: 1, branch: 1, status: 1, completedAt: -1 });
  }

  private async tree(request: GitHubRequest, treeSha: string): Promise<any[]> {
    const response = await request(`/git/trees/${encodeURIComponent(treeSha)}?recursive=1`);
    if (!Array.isArray(response.tree)) throw new Error('GitHub returned an invalid tree.');
    if (!response.truncated) return response.tree;
    const entries: any[] = [];
    const pending = [{ sha: treeSha, prefix: '' }];
    while (pending.length) {
      const current = pending.pop()!;
      const subtree = await request(`/git/trees/${encodeURIComponent(current.sha)}`);
      if (subtree.truncated || !Array.isArray(subtree.tree)) throw new Error('GitHub tree is incomplete; checkpoint preserved.');
      for (const entry of subtree.tree) {
        const path = current.prefix + entry.path;
        if (entry.type === 'tree') {
          if (['domain', 'src', 'src/domain'].includes(path) || this.isSource(path)) pending.push({ sha: entry.sha, prefix: `${path}/` });
        } else entries.push({ ...entry, path });
      }
    }
    return entries;
  }

  public async sync(input: { projectId: string; integrationId: string; branch: string }, request: GitHubRequest): Promise<any> {
    await this.ensureIndexes();
    const metadata = await request('');
    if (!Number.isSafeInteger(metadata.id)) throw new Error('GitHub repository metadata is incomplete.');
    const branch = typeof input.branch === 'string' ? input.branch.trim() : '';
    if (!branch) throw new Error('GitHub source sync requires the branch stored on the integration.');
    const repositoryId = String(metadata.id);
    const repositoryKey = { projectId: input.projectId, githubRepositoryId: metadata.id };
    const repositories = this.database.collection('github_repositories');
    await repositories.updateOne(repositoryKey, { $setOnInsert: { ...repositoryKey, createdAt: new Date() } }, { upsert: true });
    const lockToken = randomUUID();
    const lease = () => new Date(Date.now() + 10 * 60 * 1000);
    const locked = await repositories.findOneAndUpdate({
      ...repositoryKey, $or: [{ lockUntil: { $exists: false } }, { lockUntil: { $lt: new Date() } }],
    }, { $set: { lockToken, lockUntil: lease() } }, { returnDocument: 'after' });
    if (!locked) throw new Error('Repository sync already in progress.');
    const renew = async () => {
      const result = await repositories.updateOne({ ...repositoryKey, lockToken }, { $set: { lockUntil: lease() } });
      if (result.matchedCount !== 1) throw new Error('Repository sync lock lost; checkpoint preserved.');
    };
    const guardedRequest: GitHubRequest = async path => { await renew(); return request(path); };
    const scope = { projectId: input.projectId, repositoryId, branch };
    const syncs = this.database.collection('github_syncs');
    const files = this.database.collection('github_source_files');
    const changes = this.database.collection('github_file_changes');
    const runId = randomUUID();
    const startedAt = new Date();
    let previousCommitSha: string | null = null;
    let currentCommitSha: string | null = null;
    const counts = { filesAdded: 0, filesModified: 0, filesDeleted: 0, filesIgnored: 0 };
    try {
      const previous = await syncs.findOne({ ...scope, status: 'success' }, { sort: { completedAt: -1, _id: -1 } });
      previousCommitSha = previous?.lastSyncedCommitSha || previous?.currentCommitSha || null;
      await repositories.updateOne({ ...repositoryKey, lockToken }, { $set: {
        integrationId: input.integrationId, repositoryName: metadata.name,
        repositoryFullName: metadata.full_name, owner: metadata.owner?.login,
        defaultBranch: metadata.default_branch, branch, repositoryUrl: metadata.html_url,
        isPrivate: metadata.private, description: metadata.description,
        githubUpdatedAt: metadata.updated_at ? new Date(metadata.updated_at) : null,
        isActive: true, syncStatus: 'syncing', updatedAt: new Date(),
      } });
      const head = await guardedRequest(`/branches/${encodeURIComponent(branch)}`);
      currentCommitSha = head.commit?.sha;
      if (!currentCommitSha) throw new Error('Branch has no commit SHA.');
      await syncs.insertOne({ runId, ...scope, previousCommitSha, currentCommitSha, status: 'syncing', startedAt });
      let mode = previousCommitSha ? (locked.syncStatus === 'success' ? 'incremental' : 'reconcile') : 'initial';
      // Rebuild older snapshots even when HEAD has not changed: their path
      // filter excluded src/domain, so an incremental diff cannot repair them.
      if (previous && previous.sourceScopeVersion !== 3) mode = 'reconcile';
      let comparison: any = null;
      let operations: any[] = [];
      let commit: any = null;
      if (previousCommitSha === currentCommitSha && locked.syncStatus === 'success' && mode !== 'reconcile') mode = 'no_changes';
      else {
        commit = await guardedRequest(`/commits/${encodeURIComponent(currentCommitSha)}`);
        if (previousCommitSha === currentCommitSha) mode = 'reconcile';
        else if (previousCommitSha && mode !== 'reconcile') {
          try {
            comparison = await guardedRequest(`/compare/${encodeURIComponent(previousCommitSha)}...${encodeURIComponent(currentCommitSha)}?per_page=100&page=1`);
          } catch (error: any) {
            if (error.statusCode !== 404 && error.statusCode !== 422) throw error;
            mode = 'reconcile';
          }
          if (comparison && (comparison.status !== 'ahead' || !Array.isArray(comparison.files) || comparison.files.length >= 300)) mode = 'reconcile';
        }
        if (mode === 'initial' || mode === 'reconcile') {
          const treeSha = commit.commit?.tree?.sha;
          if (!treeSha) throw new Error('Commit tree SHA missing.');
          const entries = await this.tree(guardedRequest, treeSha);
          const existing = await files.find(scope).project({ path: 1, fileSha: 1, mode: 1 }).toArray();
          const byPath = new Map<string, any>(existing.map((file: any) => [file.path, file]));
          const present = new Set<string>();
          for (const entry of entries) {
            if (entry.type === 'tree') continue;
            if (!this.isSource(entry.path) || !['blob', 'commit'].includes(entry.type)) throw new Error(`Unsupported repository entry: ${entry.path}`);
            present.add(entry.path);
            const old = byPath.get(entry.path);
            if (!old || old.fileSha !== entry.sha || old.mode !== entry.mode) operations.push({
              filename: entry.path, sha: entry.sha, mode: entry.mode, size: entry.size, type: entry.type,
              status: old ? 'modified' : 'added',
            });
          }
          for (const old of existing) if (!present.has(old.path)) operations.push({ filename: old.path, status: 'removed' });
        } else {
          // Resolve entry modes/types at HEAD, including symlinks and gitlinks.
          const entries = await this.tree(guardedRequest, commit.commit.tree.sha);
          const byPath = new Map(entries.map(entry => [entry.path, entry]));
          operations = comparison.files.map((change: any) => ({ ...change, ...(() => {
            const entry = byPath.get(change.filename);
            return entry ? { mode: entry.mode, type: entry.type } : {};
          })() }));
        }
      }
      const upserts: any[] = [];
      const deletions = new Set<string>();
      const history: any[] = [];
      const candidates: any[] = [];
      for (const change of operations) {
        const inside = this.isSource(change.filename);
        const oldInside = this.isSource(change.previous_filename);
        if (change.status === 'renamed' && oldInside) deletions.add(change.previous_filename);
        if (!inside && !oldInside) { counts.filesIgnored += 1; continue; }
        if (inside && ['removed', 'deleted'].includes(change.status)) deletions.add(change.filename);
        else if (inside) candidates.push(change);
        history.push({ updateOne: {
          filter: { ...scope, commitSha: currentCommitSha, path: inside ? change.filename : change.previous_filename },
          update: { $set: {
            ...scope, path: inside ? change.filename : change.previous_filename,
            previousPath: change.previous_filename || null,
            changeStatus: change.status === 'removed' ? 'deleted' : change.status,
            fileSha: change.sha || null, commitSha: currentCommitSha,
            commitMessage: commit?.commit?.message || '',
            commitAuthorName: commit?.commit?.author?.name || '',
            commitAuthorEmail: commit?.commit?.author?.email || '',
            githubAuthor: commit?.author?.login || '', commitUrl: commit?.html_url || '',
            additions: change.additions ?? null, deletions: change.deletions ?? null,
            changes: change.changes ?? null, patch: change.patch || null,
            changedAt: commit?.commit?.author?.date ? new Date(commit.commit.author.date) : null,
            syncedAt: new Date(),
          } }, upsert: true,
        } });
      }
      for (let offset = 0; offset < candidates.length; offset += 5) {
        const batch = await Promise.allSettled(candidates.slice(offset, offset + 5).map(async change => {
          if (!change.sha) throw new Error(`Source file has no SHA: ${change.filename}`);
          const isSubmodule = change.type === 'commit' || change.mode === '160000';
          const blob = isSubmodule ? { encoding: 'base64', sha: change.sha, content: Buffer.from(change.sha).toString('base64') }
            : await guardedRequest(`/git/blobs/${encodeURIComponent(change.sha)}`);
          if (blob.encoding !== 'base64' || typeof blob.content !== 'string' || blob.sha !== change.sha) throw new Error(`Invalid Git blob: ${change.filename}`);
          const decoded = Buffer.from(blob.content.replace(/\s/g, ''), 'base64');
          let content: string;
          let encoding = 'utf8';
          try {
            content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(decoded);
            if (content.includes('\u0000')) throw new Error('binary');
          } catch { content = decoded.toString('base64'); encoding = 'base64'; }
          // Keep documents comfortably below MongoDB's BSON limit. Large
          // files are retained losslessly as ordered base64 byte chunks.
          let chunkCount = 0;
          if (Buffer.byteLength(content, 'utf8') > 4 * 1024 * 1024) {
            const chunks = this.database.collection('github_source_chunks');
            for (let start = 0; start < decoded.length; start += 3 * 1024 * 1024) {
              await chunks.updateOne({ ...scope, fileSha: change.sha, index: chunkCount }, { $set: {
                ...scope, fileSha: change.sha, index: chunkCount,
                content: decoded.subarray(start, start + 3 * 1024 * 1024).toString('base64'), encoding: 'base64',
              } }, { upsert: true });
              chunkCount++;
            }
            content = encoding === 'utf8' ? content.slice(0, 6000) : '';
          }
          const extension = change.filename.split('.').pop();
          const language = ({ ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', py: 'python', java: 'java', go: 'go', json: 'json' } as any)[extension] || extension;
          upserts.push({ updateOne: { filter: { ...scope, path: change.filename }, update: { $set: {
            ...scope, path: change.filename, fileSha: change.sha, commitSha: currentCommitSha,
            content, encoding, storage: chunkCount ? 'chunks' : 'inline', chunkCount,
            fileType: isSubmodule ? 'submodule' : change.mode === '120000' ? 'symlink' : 'blob', mode: change.mode || '100644', language,
            fileSize: decoded.length, lastCommitMessage: commit?.commit?.message || '',
            lastCommitDate: commit?.commit?.author?.date ? new Date(commit.commit.author.date) : null,
            lastSyncedAt: new Date(),
          } }, upsert: true } });
          if (change.status === 'added') counts.filesAdded += 1;
          else counts.filesModified += 1;
        }));
        const failed = batch.find(result => result.status === 'rejected') as PromiseRejectedResult | undefined;
        if (failed) throw failed.reason;
      }
      await renew();
      if (deletions.size) await files.deleteMany({ ...scope, path: { $in: [...deletions] } });
      counts.filesDeleted = deletions.size;
      if (upserts.length) await files.bulkWrite(upserts, { ordered: true });
      if (history.length) await changes.bulkWrite(history, { ordered: true });
      await renew();
      const completedAt = new Date();
      const result = { ...scope, ...counts, sourceScopeVersion: 3, mode, status: 'success', previousCommitSha, currentCommitSha,
        lastSyncedCommitSha: currentCommitSha, lastSyncedAt: completedAt, startedAt, completedAt,
        compareStatus: comparison?.status || null, commitsAhead: comparison?.ahead_by || 0, commitsBehind: comparison?.behind_by || 0, error: null };
      await repositories.updateOne({ ...repositoryKey, lockToken }, { $set: { syncStatus: 'success', updatedAt: completedAt } });
      await syncs.updateOne({ runId }, { $set: result });
      return result;
    } catch (error: any) {
      await repositories.updateOne({ ...repositoryKey, lockToken }, { $set: { syncStatus: 'failed', updatedAt: new Date() } }).catch(() => undefined);
      await syncs.updateOne({ runId }, { $set: { ...scope, previousCommitSha, currentCommitSha,
        status: 'failed', ...counts, startedAt, completedAt: new Date(), error: error.message || 'Source sync failed.' } }, { upsert: true }).catch(() => undefined);
      throw error;
    } finally {
      await repositories.updateOne({ ...repositoryKey, lockToken }, { $unset: { lockToken: '', lockUntil: '' } }).catch(() => undefined);
    }
  }

  public async status(projectId: string): Promise<any[]> {
    const repositories = await this.database.collection('github_repositories').find({ projectId, isActive: true }).toArray();
    return Promise.all(repositories.map(async (repository: any) => {
      const scope = { projectId, repositoryId: String(repository.githubRepositoryId), branch: repository.branch };
      const latest = await this.database.collection('github_syncs').findOne(scope, { sort: { startedAt: -1, _id: -1 } });
      const successful = await this.database.collection('github_syncs').findOne({ ...scope, status: 'success' }, { sort: { completedAt: -1, _id: -1 } });
      return { ...scope, repositoryFullName: repository.repositoryFullName, integrationId: repository.integrationId,
        status: repository.lockUntil > new Date() ? 'syncing' : latest?.status || 'idle',
        lastSyncedCommitSha: successful?.lastSyncedCommitSha || null,
        lastSyncedAt: successful?.completedAt || null, latest: latest || null };
    }));
  }
}
