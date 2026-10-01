export class GitHubCodeContextService {
  constructor(private readonly database: any = global.db.connection.db) {}

  /** `includeFiles: false` returns snapshot status and activity only, for callers that search files themselves. */
  public async build(projectId: string, options: { includeFiles?: boolean } = {}): Promise<any> {
    const connections = await this.database.collection('integrations').find({ project_id: projectId, provider: 'github', is_deleted: false })
      .project({ _id: 1, category: 1, repository_name: 1 }).toArray();
    const connectionById = new Map<string, any>(connections.map((connection: any) => [String(connection._id), connection]));
    const repositories = await this.database.collection('github_repositories').find({
      projectId, isActive: true, integrationId: { $in: connections.map((connection: any) => String(connection._id)) },
    }).toArray();
    const sourceFiles: any[] = [];
    const snapshots: any[] = [];
    let remaining = 60000;
    let totalFiles = 0;
    let incomplete = repositories.length === 0;
    for (const repository of repositories) {
      const scope = { projectId, repositoryId: String(repository.githubRepositoryId), branch: repository.branch };
      const connection = connectionById.get(String(repository.integrationId));
      const repositoryMeta = { repositoryFullName: repository.repositoryFullName || connection?.repository_name,
        category: repository.category || connection?.category || 'other' };
      const checkpoint = await this.database.collection('github_syncs').findOne({ ...scope, status: 'success' }, { sort: { completedAt: -1, _id: -1 } });
      if (!checkpoint || repository.syncStatus !== 'success' || repository.lockUntil > new Date()) {
        incomplete = true;
        snapshots.push({ ...scope, ...repositoryMeta, status: repository.syncStatus || 'unavailable' });
        continue;
      }
      const count = await this.database.collection('github_source_files').countDocuments(scope);
      incomplete ||= count === 0 || checkpoint.sourceScopeVersion !== 3;
      totalFiles += count;
      const rows = options.includeFiles === false ? [] : await this.database.collection('github_source_files').aggregate([
        { $match: { ...scope, encoding: 'utf8', fileType: 'blob' } }, { $sort: { path: 1 } }, { $limit: 100 },
        { $project: { _id: 0, repositoryId: 1, branch: 1, path: 1, fileSha: 1, commitSha: 1, language: 1,
          storage: 1, content: { $substrCP: ['$content', 0, 6000] }, contentLength: { $strLenCP: '$content' } } },
      ]).toArray();
      const included: any[] = [];
      for (const file of rows) {
        if (remaining <= 0) break;
        const content = file.content.slice(0, remaining);
        const truncated = file.storage === 'chunks' || content.length < file.contentLength;
        incomplete ||= truncated;
        included.push({ ...file, evidenceId: `${file.repositoryId}:${file.branch}:${file.path}`, content, truncated });
        remaining -= content.length;
      }
      const after = await this.database.collection('github_repositories').findOne({ _id: repository._id });
      const afterCheckpoint = await this.database.collection('github_syncs').findOne({ ...scope, status: 'success' }, { sort: { completedAt: -1, _id: -1 } });
      if (!after || after.syncStatus !== 'success' || after.lockUntil > new Date()
        || new Date(after.updatedAt).getTime() !== new Date(repository.updatedAt).getTime()
        || afterCheckpoint?.runId !== checkpoint.runId) {
        incomplete = true;
        snapshots.push({ ...scope, ...repositoryMeta, status: 'changed_during_read' });
        continue;
      }
      incomplete ||= included.length < count;
      sourceFiles.push(...included);
      snapshots.push({ ...scope, ...repositoryMeta, status: 'success', commitSha: checkpoint.lastSyncedCommitSha,
        lastSyncedAt: checkpoint.completedAt, totalFiles: count, includedFiles: included.length });
    }
    const [commits, pullRequests, workItems] = await Promise.all([
      this.database.collection('commits').find({ project_id: projectId, is_deleted: false })
        .project({ sha: 1, repository_id: 1, message: 1, committed_at: 1 }).sort({ committed_at: -1 }).limit(30).toArray(),
      this.database.collection('pull_requests').find({ project_id: projectId, is_deleted: false })
        .project({ number: 1, repository_id: 1, title: 1, status: 1 }).sort({ created_at: -1 }).limit(30).toArray(),
      this.database.collection('work_items').find({ project_id: projectId, is_deleted: false })
        .project({ title: 1, status: 1, source: 1, sprint_id: 1, story_points: 1 }).limit(100).toArray(),
    ]);
    return { sourceFilter: '** (text excerpts only in AI context)', repositories: snapshots, files: sourceFiles,
      coverage: { totalFiles, includedFiles: sourceFiles.length, incomplete },
      commits, pullRequests, workItems };
  }

  public normalizeAnalysis(tasks: any[], response: any, context: any): any {
    const evidence = new Map<string, any>(context.files.map((file: any) => [file.evidenceId, file]));
    const allowed = ['IMPLEMENTED', 'PARTIAL', 'NOT_IMPLEMENTED', 'UNCLEAR'];
    const items = tasks.map(task => {
      const matches = Array.isArray(response?.items) ? response.items.filter((item: any) => item.id === task.id) : [];
      const candidate = matches.length === 1 ? matches[0] : {};
      const citations = (Array.isArray(candidate.evidence) ? candidate.evidence : []).filter((citation: any) => {
        const file = evidence.get(citation.evidenceId);
        return file && typeof citation.quote === 'string' && citation.quote.trim().length >= 8 && file.content.includes(citation.quote);
      });
      let status = allowed.includes(candidate.status) ? candidate.status : 'UNCLEAR';
      if (['IMPLEMENTED', 'PARTIAL'].includes(status) && !citations.length) status = 'UNCLEAR';
      if (status === 'NOT_IMPLEMENTED' && (context.coverage.incomplete || !context.files.length)) status = 'UNCLEAR';
      return { ...task, status, evidence: citations, explanation: String(candidate.explanation || 'Insufficient evidence.').slice(0, 2000) };
    });
    const totalWeight = items.reduce((total, item) => total + item.weight, 0);
    const earnedWeight = items.reduce((total, item) => total + item.weight * (item.status === 'IMPLEMENTED' ? 1 : item.status === 'PARTIAL' ? 0.5 : 0), 0);
    return { items, progressPercent: totalWeight ? Math.round(earnedWeight / totalWeight * 100) : 0,
      totalWeight, earnedWeight, unclearItems: items.filter(item => item.status === 'UNCLEAR').length,
      scoring: { IMPLEMENTED: 1, PARTIAL: 0.5, NOT_IMPLEMENTED: 0, UNCLEAR: 0 },
      coverage: context.coverage, repositories: context.repositories };
  }
}
