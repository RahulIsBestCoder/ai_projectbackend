import { AI_CONTEXT_CONFIG } from '../../../configuration/context.config';

/** Read-only, project-scoped access to successfully synced repository snapshots. */
export class RepositoryReader {
  constructor(private readonly db: any = global.db.connection.db) {}

  private async scopes(projectId: string): Promise<any[]> {
    const links = await this.db.collection('integrations').find({ project_id: projectId, provider: 'github', is_deleted: false }).project({ _id: 1 }).toArray();
    const repos = await this.db.collection('github_repositories').find({ projectId, isActive: true,
      integrationId: { $in: links.map((link: any) => String(link._id)) } }).toArray();
    const scopes = [];
    for (const repo of repos) {
      if (repo.syncStatus !== 'success' || repo.lockUntil > new Date()) continue;
      const scope = { projectId, repositoryId: String(repo.githubRepositoryId), branch: repo.branch };
      const checkpoint = await this.db.collection('github_syncs').findOne({ ...scope, status: 'success' }, { sort: { completedAt: -1, _id: -1 } });
      if (checkpoint?.sourceScopeVersion !== 3) continue;
      scopes.push({ ...scope, repository: repo.repositoryFullName, commit: checkpoint.lastSyncedCommitSha,
        syncedAt: checkpoint.completedAt, runId: checkpoint.runId });
    }
    return scopes;
  }

  public async execute(projectId: string, action: any): Promise<any> {
    if (!action || typeof action !== 'object') throw new Error('Invalid repository action.');
    const scopes = await this.scopes(projectId);
    if (action.tool === 'repositories') return { repositories: scopes, note: 'Synced snapshots, not live GitHub. Missing repositories require successful source sync.' };
    const selected = scopes.find(scope => scope.repositoryId === action.repositoryId && scope.branch === action.branch);
    if (!selected) throw new Error('Repository/branch is unavailable for this project or needs source sync.');
    const { projectId: project, repositoryId, branch } = selected;
    const scope = { projectId: project, repositoryId, branch };
    const files = this.db.collection('github_source_files');
    const offset = Number.isSafeInteger(action.offset) && action.offset >= 0 ? Math.min(action.offset, 100000000) : 0;
    let result: any;
    if (action.tool === 'list' || action.tool === 'search') {
      const query: any = { ...scope };
      if (action.tool === 'search') {
        if (typeof action.query !== 'string' || !action.query.trim() || action.query.length > 120) throw new Error('Search requires 1-120 characters.');
        const escaped = action.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // `field: 'path'` matches file paths only: cheap, and not crowded out by files that merely mention the term.
        if (action.field === 'path') query.path = { $regex: escaped, $options: 'i' };
        else query.$or = [{ path: { $regex: escaped, $options: 'i' } },
          { encoding: 'utf8', content: { $regex: escaped, $options: 'i' } }];
      }
      const rows = await files.find(query).project({ _id: 0, path: 1, language: 1, fileSize: 1, encoding: 1, storage: 1, fileType: 1 })
        .sort({ path: 1 }).skip(offset).limit(51).maxTimeMS(5000).toArray();
      result = { files: rows.slice(0, 50), nextOffset: rows.length > 50 ? offset + 50 : null,
        note: 'Search covers paths and stored text previews; large-file bodies require read. Listing does not prove implementation.' };
    } else if (action.tool === 'read') {
      if (typeof action.path !== 'string' || action.path.length > 2048) throw new Error('An exact file path is required.');
      if (/(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|credentials(?:\..*)?)$|\.(pem|p12|pfx|key)$/i.test(action.path)) {
        throw new Error('Credential file contents are not exposed to AI.');
      }
      const file = await files.findOne({ ...scope, path: action.path });
      if (!file) throw new Error('File not found in this snapshot.');
      if (file.encoding !== 'utf8' || file.fileType !== 'blob') {
        result = { path: file.path, fileType: file.fileType, encoding: file.encoding, note: 'Binary files and references are stored but are not executable or readable source evidence.' };
      } else {
        let bytes: Buffer;
        if (file.storage === 'chunks') {
          const size = 3 * 1024 * 1024;
          const index = Math.floor(offset / size);
          const chunks = await this.db.collection('github_source_chunks').find({ ...scope, fileSha: file.fileSha, index: { $in: [index, index + 1] } }).sort({ index: 1 }).toArray();
          if (offset < file.fileSize && (!chunks.length || chunks[0].index !== index)) throw new Error('Source chunks unavailable; re-sync required.');
          bytes = Buffer.concat(chunks.map((chunk: any) => Buffer.from(chunk.content, 'base64'))).subarray(offset % size, offset % size + 12000);
        } else bytes = Buffer.from(file.content, 'utf8').subarray(offset, offset + 12000);
        result = { path: file.path, fileSha: file.fileSha, byteOffset: offset, content: bytes.toString('utf8'),
          nextOffset: offset + bytes.length < file.fileSize ? offset + bytes.length : null };
      }
    } else throw new Error('Unknown repository tool.');
    const after = (await this.scopes(projectId)).find(item => item.repositoryId === repositoryId && item.branch === branch);
    if (!after || after.runId !== selected.runId) throw new Error('Snapshot changed during read; retry.');
    return { repository: selected.repository, branch, commit: selected.commit, syncedAt: selected.syncedAt, ...result };
  }
}

/** Provider-neutral structured tool loop; no shell execution or external URLs. */
export async function investigateRepository(prompt: string, projectId: string,
  generate: (prompt: string) => Promise<string>, reader = new RepositoryReader()): Promise<string> {
  const evidence: any[] = [await reader.execute(projectId, { tool: 'repositories' })];
  if (!evidence[0].repositories.length) return 'No successfully synced whole-repository snapshot is available. Repository contents and implementation status are unknown.';
  // Seed the investigation deterministically. Smaller/local models often reply
  // with prose instead of the requested tool JSON, so relevant files must not
  // depend entirely on model-directed tool use.
  const stopWords = new Set(['about', 'after', 'also', 'answer', 'backend', 'code', 'does', 'feature', 'find', 'from', 'have', 'implemented', 'into', 'project', 'repo', 'repository', 'system', 'that', 'the', 'this', 'what', 'when', 'where', 'with', 'your']);
  const keywords = Array.from(new Set((prompt.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [])
    .filter(word => !stopWords.has(word)))).slice(-3);
  const candidates = new Map<string, { action: any; score: number }>();
  for (const repository of evidence[0].repositories) {
    for (const query of keywords) {
      const action = { tool: 'search', repositoryId: repository.repositoryId, branch: repository.branch, query };
      try {
        const result = await reader.execute(projectId, action);
        evidence.push({ action, result: { ...result, files: result.files.slice(0, 15) } });
        for (const file of result.files.slice(0, 15)) {
          if (file.encoding !== 'utf8' || file.fileType !== 'blob') continue;
          const key = `${repository.repositoryId}\u0000${repository.branch}\u0000${file.path}`;
          const existing = candidates.get(key);
          candidates.set(key, { action: { tool: 'read', repositoryId: repository.repositoryId, branch: repository.branch, path: file.path }, score: (existing?.score || 0) + 1 });
        }
      } catch (err: any) { evidence.push({ action, error: err.message }); }
    }
  }
  for (const candidate of [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 4)) {
    try { evidence.push({ action: candidate.action, result: await reader.execute(projectId, candidate.action) }); }
    catch (err: any) { evidence.push({ action: candidate.action, error: err.message }); }
  }
  for (let round = 0; round < 3; round++) {
    const response = await generate(AI_CONTEXT_CONFIG.repositoryInvestigationPrompt(prompt.slice(-16000), evidence));
    let action: any;
    try { action = JSON.parse(response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
    catch { evidence.push({ warning: 'Investigation stopped: model did not return a valid repository action.' }); break; }
    if (action.tool === 'done') break;
    try { evidence.push({ action, result: await reader.execute(projectId, action) }); }
    catch (err: any) { evidence.push({ action, error: err.message }); }
  }
  return JSON.stringify({ evidence, limitation: 'Bounded investigation of synced snapshots; unexamined files and unexecuted tests remain unknown.' });
}
