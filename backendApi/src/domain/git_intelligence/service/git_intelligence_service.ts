import { GitIntelligenceModel } from '../models/git_intelligence_model';
import { IntegrationModel } from '../../integration/models/integration_model';
import {
  normalizeRepoCategory,
  REPO_CATEGORIES,
  IRepositoryCreate,
  IRepositoryUpdate,
} from '../interface/git_intelligence_interface';
import { IServiceResult } from '../../../helper/common_interface';

/**
 * `GitIntelligenceService` – Business logic for linked-repository CRUD (plan §06).
 */
export class GitIntelligenceService {
  private readonly _repositoryModel = new GitIntelligenceModel();
  private readonly _integrationModel = new IntegrationModel();
  private readonly logName = 'git_intelligence_service';

  private initLog(): void {
    /* parity with plan convention */
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  /*
   * Category helpers — every git info / list response carries the repository
   * category so the UI can divide the data by team/purpose ("UI Team",
   * "Backend", "Apps", "Shared", "Other") without extra round trips.
   */

  /**
   * Build a lookup of repositoryId -> { category, repository_name } for one
   * project. Synced artifacts store the repo document's `_id`; the raw
   * string id (`owner/repo`) is indexed too so both shapes resolve.
   */
  private async repoCategoryMap(
    projectId: string,
  ): Promise<Map<string, { category: string; repository_name: string }>> {
    const repos: any[] = await this._repositoryModel.findAllByAny({ project_id: projectId, is_deleted: false });
    const map = new Map<string, { category: string; repository_name: string }>();
    for (const r of repos || []) {
      const meta = {
        category: normalizeRepoCategory((r as any).category),
        repository_name: (r as any).name || (r as any).full_name || (r as any).repository_id || '',
      };
      map.set(String((r as any)._id), meta);
      if ((r as any).repository_id) map.set(String((r as any).repository_id), meta);
    }
    return map;
  }

  /** Totals-based roll-up from per-repo groups (a busy repo can own a page). */
  private totalsByCategory(groups: any[]): Record<string, number> {
    const byCategory: Record<string, number> = {};
    for (const g of groups || []) {
      const key = (g as any).category || 'other';
      byCategory[key] = (byCategory[key] || 0) + Number((g as any).total || 0);
    }
    return byCategory;
  }

  /** Count rows per category — the roll-up shipped with every list payload. */
  private categoryRollup(rows: any[]): Record<string, number> {
    const byCategory: Record<string, number> = {};
    for (const r of rows || []) {
      const key = (r as any).category || 'other';
      byCategory[key] = (byCategory[key] || 0) + 1;
    }
    return byCategory;
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: createRepository
   */
  public async createRepository(param: IRepositoryCreate): Promise<IServiceResult> {
    this.initLog();
    this.log('createRepository', ['Request : ', param]);
    try {
      const existing: any = await this._repositoryModel.findByAny({ repository_id: param.repository_id, provider: param.provider });
      if (existing && !existing.is_deleted) {
        return global.Helpers.makeBadServiceStatus('Repository already exists.');
      }
      // Normalize the team/purpose dropdown (unknown values fall back to 'other').
      param.category = normalizeRepoCategory(param.category);
      if (existing && existing.is_deleted) {
        // Revive a previously disconnected repository instead of blocking re-link
        // (parity with the integration domain's revive behavior).
        await this._repositoryModel.updateAnyRecord(
          { _id: existing._id },
          {
            is_deleted: false,
            deleted_at: null,
            project_id: (param as any).project_id ?? existing.project_id,
            category: param.category,
            updated_at: new Date(),
          },
        );
        const revived = await this._repositoryModel.findByAny({ _id: existing._id });
        this.log('createRepository', 'Revived soft-deleted repository.');
        return global.Helpers.makeSuccessServiceStatus('Repository re-linked.', revived);
      }
      const newRepository = await this._repositoryModel.addNewRecord(param);
      this.log('Add new repository result:', newRepository);
      return global.Helpers.makeSuccessServiceStatus('Repository created.', newRepository);
    } catch (err: any) {
      this.log('createRepository', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: getRepository
   */
  public async getRepository(repositoryId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getRepository', ['Request : ', repositoryId]);
    try {
      const repository = await this._repositoryModel.findByAny({ _id: repositoryId });
      if (!repository) {
        return global.Helpers.makeBadServiceStatus('Repository not found.');
      }
      return global.Helpers.makeSuccessServiceStatus('Repository fetched.', repository);
    } catch (err: any) {
      this.log('getRepository', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: updateRepository
   */
  public async updateRepository(repositoryId: string, param: IRepositoryUpdate): Promise<IServiceResult> {
    this.initLog();
    this.log('updateRepository', ['Request : ', { repositoryId, param }]);
    try {
      const existing: any = await this._repositoryModel.findByAny({ _id: repositoryId });
      if (!existing) {
        return global.Helpers.makeBadServiceStatus('Repository not found.');
      }
      // Normalize the team/purpose dropdown (unknown values fall back to 'other').
      if (param.category !== undefined) {
        param.category = normalizeRepoCategory(param.category);
      }
      await this._repositoryModel.updateAnyRecord({ _id: repositoryId }, param);

      // Keep the linked integration in sync so the next sync run does not
      // overwrite the category the user just changed here.
      if (param.category !== undefined && existing.integration_id) {
        await this._integrationModel.updateAnyRecord(
          { _id: String(existing.integration_id) },
          { category: param.category, updated_at: new Date() },
        );
        this.log('updateRepository', `Propagated category "${param.category}" to integration ${existing.integration_id}`);
      }

      // Return the fresh document (updateMany only returns counts).
      const updated = await this._repositoryModel.findByAny({ _id: repositoryId });
      this.log('Update repository result:', updated);
      return global.Helpers.makeSuccessServiceStatus('Repository updated.', updated);
    } catch (err: any) {
      this.log('updateRepository', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: deleteRepository
   */
  public async deleteRepository(repositoryId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('deleteRepository', ['Request : ', repositoryId]);
    try {
      const deleted = await this._repositoryModel.updateAnyRecord({ _id: repositoryId }, { is_deleted: true });
      this.log('Delete repository result:', deleted);
      return global.Helpers.makeSuccessServiceStatus('Repository deleted.', deleted);
    } catch (err: any) {
      this.log('deleteRepository', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  public async getByProject(projectId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getByProject', ['Request : ', projectId]);
    try {
      const repositories = await this._repositoryModel.findAllByAny({ project_id: projectId, is_deleted: false });
      // Group the rows by the team/purpose dropdown so the UI can render
      // grouped tabs/badges ("this repo is for the UI team, this for backend...").
      const byCategory: Record<string, number> = {};
      for (const r of repositories || []) {
        const key = (r as any).category || 'other';
        byCategory[key] = (byCategory[key] || 0) + 1;
      }
      return global.Helpers.makeSuccessServiceStatus('Repositories fetched.', {
        rows: repositories,
        count: repositories.length,
        by_category: byCategory,
        categories: REPO_CATEGORIES,
      });
    } catch (err: any) {
      this.log('getByProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  public async getCommitsByProject(
    projectId: string,
    page: number = 1,
    limit: number = 20,
    repositoryId?: string,
  ): Promise<IServiceResult> {
    this.initLog();
    this.log('getCommitsByProject', ['Request : ', { projectId, page, limit, repositoryId }]);
    try {
      const offset = (page - 1) * limit;
      const db = global.db.connection.db!;
      const repositories: any[] = await this._repositoryModel.findAllByAny({ project_id: projectId, is_deleted: false });
      const selectedRepository = repositoryId
        ? repositories.find(repository => [repository._id, repository.repository_id, repository.name]
          .some(value => String(value || '') === repositoryId))
        : undefined;
      const query: Record<string, unknown> = { project_id: projectId };
      if (repositoryId) {
        query.repository_id = selectedRepository
          ? { $in: [selectedRepository._id, selectedRepository.repository_id, selectedRepository.name]
            .filter(Boolean).map(String) }
          : repositoryId;
      }
      const commits = await db.collection('commits').find(query).sort({ date: -1 }).skip(offset).limit(limit).toArray();
      const total = await db.collection('commits').countDocuments(query);
      // Category division: stamp each commit with its repository's category
      // and ship the roll-up + catalog so the UI can group without extra calls.
      const catMap = await this.repoCategoryMap(projectId);
      const rows = (commits || []).map((c: any) => {
        const meta = catMap.get(String(c.repository_id || ''));
        return { ...c, category: meta?.category || 'other', repository_name: meta?.repository_name || undefined };
      });

      // A single high-activity repository can occupy the entire globally
      // paginated `rows` list. Include an independently paginated list for
      // every linked repository so clients never mistake that for missing data.
      const repositoryGroups = await Promise.all(repositories.map(async repository => {
        const storedId = String(repository._id);
        const repositoryIds = [repository._id, repository.repository_id, repository.name]
          .filter(Boolean).map(String);
        const repositoryQuery = { project_id: projectId, repository_id: { $in: repositoryIds } };
        const [repositoryCommits, repositoryTotal] = await Promise.all([
          db.collection('commits').find(repositoryQuery).sort({ date: -1 }).skip(offset).limit(limit).toArray(),
          db.collection('commits').countDocuments(repositoryQuery),
        ]);
        const repositoryName = repository.name || repository.repository_id || '';
        return {
          repository_id: storedId,
          repository_name: repositoryName,
          category: normalizeRepoCategory(repository.category),
          rows: repositoryCommits.map(commit => ({
            ...commit,
            category: normalizeRepoCategory(repository.category),
            repository_name: repositoryName,
          })),
          count: repositoryCommits.length,
          total: repositoryTotal,
          page,
          limit,
          total_pages: Math.ceil(repositoryTotal / limit),
        };
      }));
      return global.Helpers.makeSuccessServiceStatus('Commits fetched.', {
        rows, count: rows.length, page, limit,
        total_pages: Math.ceil(total / limit), total,
        repositories: repositoryGroups,
        by_category: this.totalsByCategory(repositoryGroups),
        categories: REPO_CATEGORIES,
      });
    } catch (err: any) {
      this.log('getCommitsByProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  public async getPullRequestsByProject(projectId: string, page: number = 1, limit: number = 20, repositoryId?: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getPullRequestsByProject', ['Request : ', { projectId, page, limit, repositoryId }]);
    try {
      const offset = (page - 1) * limit;
      const db = global.db.connection.db!;
      const repositories: any[] = await this._repositoryModel.findAllByAny({ project_id: projectId, is_deleted: false });
      const selectedRepository = repositoryId
        ? repositories.find(repository => [repository._id, repository.repository_id, repository.name]
          .some(value => String(value || '') === repositoryId))
        : undefined;
      const query: Record<string, unknown> = { project_id: projectId };
      if (repositoryId) {
        query.repository_id = selectedRepository
          ? { $in: [selectedRepository._id, selectedRepository.repository_id, selectedRepository.name].filter(Boolean).map(String) }
          : repositoryId;
      }
      const prs = await db.collection('pull_requests').find(query).sort({ created_at: -1 }).skip(offset).limit(limit).toArray();
      const total = await db.collection('pull_requests').countDocuments(query);
      // Category division: stamp each PR with its repository's category and
      // ship the roll-up + catalog so the UI can group without extra calls.
      const catMap = await this.repoCategoryMap(projectId);
      const rows = (prs || []).map((p: any) => {
        const meta = catMap.get(String(p.repository_id || ''));
        return { ...p, category: meta?.category || 'other', repository_name: meta?.repository_name || undefined };
      });
      const repositoryGroups = await Promise.all(repositories.map(async repository => {
        const storedId = String(repository._id);
        const repositoryIds = [repository._id, repository.repository_id, repository.name]
          .filter(Boolean).map(String);
        const repositoryQuery = { project_id: projectId, repository_id: { $in: repositoryIds } };
        const [repositoryPrs, repositoryTotal] = await Promise.all([
          db.collection('pull_requests').find(repositoryQuery).sort({ created_at: -1 }).skip(offset).limit(limit).toArray(),
          db.collection('pull_requests').countDocuments(repositoryQuery),
        ]);
        const repositoryName = repository.name || repository.repository_id || '';
        return {
          repository_id: storedId,
          repository_name: repositoryName,
          category: normalizeRepoCategory(repository.category),
          rows: repositoryPrs.map(pr => ({
            ...pr,
            category: normalizeRepoCategory(repository.category),
            repository_name: repositoryName,
          })),
          count: repositoryPrs.length,
          total: repositoryTotal,
          page,
          limit,
          total_pages: Math.ceil(repositoryTotal / limit),
        };
      }));
      return global.Helpers.makeSuccessServiceStatus('Pull requests fetched.', {
        rows, count: rows.length, page, limit,
        total_pages: Math.ceil(total / limit), total,
        repositories: repositoryGroups,
        by_category: this.totalsByCategory(repositoryGroups),
        categories: REPO_CATEGORIES,
      });
    } catch (err: any) {
      this.log('getPullRequestsByProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  public async getContributorsByProject(projectId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getContributorsByProject', ['Request : ', projectId]);
    try {
      const db = global.db.connection.db!;
      // Category division: one row per (author, repo-category) so the
      // leaderboard can be split by team/purpose; `contributors` keeps the
      // distinct-author count for backward compatibility.
      const commits: any[] = await db.collection('commits')
        .find({ project_id: projectId })
        .project({ author_email: 1, author_name: 1, additions: 1, deletions: 1, repository_id: 1 })
        .toArray();
      const catMap = await this.repoCategoryMap(projectId);
      type Bucket = { author_email: string; name: string; category: string; commits: number; additions: number; deletions: number };
      const buckets = new Map<string, Bucket>();
      const authorsByCategory: Record<string, Set<string>> = {};
      const authors = new Set<string>();
      for (const c of commits || []) {
        const meta = catMap.get(String(c.repository_id || ''));
        const category = meta?.category || 'other';
        const email = String(c.author_email || 'unknown');
        const key = `${email}::${category}`;
        const bucket = buckets.get(key) || { author_email: email, name: c.author_name || '', category, commits: 0, additions: 0, deletions: 0 };
        bucket.name = bucket.name || c.author_name || '';
        bucket.commits += 1;
        bucket.additions += Number(c.additions) || 0;
        bucket.deletions += Number(c.deletions) || 0;
        buckets.set(key, bucket);
        authors.add(email);
        (authorsByCategory[category] = authorsByCategory[category] || new Set()).add(email);
      }
      const contributors = Array.from(buckets.values()).sort((a, b) => b.commits - a.commits);
      const byCategory: Record<string, number> = {};
      for (const [category, set] of Object.entries(authorsByCategory)) {
        byCategory[category] = set.size;
      }
      return global.Helpers.makeSuccessServiceStatus('Contributors fetched.', {
        rows: contributors, count: contributors.length,
        contributors: authors.size,
        by_category: byCategory,
        categories: REPO_CATEGORIES,
      });
    } catch (err: any) {
      this.log('getContributorsByProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /* ==================== git metrics & activity (plan §06) ==================== */

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getMetrics
   * @Description: Roll-up of commit/PR metrics for a project: totals,
   *               lines moved, merge rate, review depth, top author.
   */
  public async getMetrics(projectId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getMetrics', ['Request : ', projectId]);
    try {
      const db = global.db.connection.db!;
      const commitStats = await db.collection('commits').aggregate([
        { $match: { project_id: projectId } },
        { $group: {
          _id: null,
          commits: { $sum: 1 },
          additions: { $sum: { $ifNull: ['$additions', 0] } },
          deletions: { $sum: { $ifNull: ['$deletions', 0] } },
          files_changed: { $sum: { $ifNull: ['$files_changed', 0] } },
          authors: { $addToSet: '$author_email' },
        } },
      ]).toArray();
      const c = commitStats[0] || { commits: 0, additions: 0, deletions: 0, files_changed: 0, authors: [] };

      const prStats = await db.collection('pull_requests').aggregate([
        { $match: { project_id: projectId } },
        { $group: {
          // PR docs store lifecycle in `status` (open | merged | closed)
          _id: { $ifNull: ['$status', 'unknown'] },
          count: { $sum: 1 },
          avg_reviews: { $avg: { $size: { $ifNull: ['$reviews', []] } } },
          merged_count: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$merged_at', 0] }, 0] }, 1, 0] } },
        } },
      ]).toArray();
      const prByStatus: Record<string, number> = {};
      let totalPRs = 0;
      let weightedReviews = 0;
      let mergedTotal = 0;
      prStats.forEach((p: any) => {
        prByStatus[p._id] = p.count;
        totalPRs += p.count;
        weightedReviews += (p.avg_reviews || 0) * p.count;
        mergedTotal += p.merged_count || 0;
      });
      // merged = lifecycle status OR an actual merge timestamp (defensive)
      const merged = Math.max(prByStatus['merged'] || 0, mergedTotal);

      // commits per day over the last 14 days for a mini activity sparkline
      const since = new Date(Date.now() - 14 * 86400000);
      const daily = await db.collection('commits').aggregate([
        { $match: { project_id: projectId, committed_at: { $gte: since } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$committed_at' } },
          commits: { $sum: 1 },
          additions: { $sum: { $ifNull: ['$additions', 0] } },
          deletions: { $sum: { $ifNull: ['$deletions', 0] } },
        } },
        { $sort: { _id: 1 } },
      ]).toArray();

      // Category division — the same metrics rolled up per repo category.
      const catMap = await this.repoCategoryMap(projectId);
      const commitRows: any[] = await db.collection('commits')
        .find({ project_id: projectId })
        .project({ additions: 1, deletions: 1, repository_id: 1 })
        .toArray();
      const prRows: any[] = await db.collection('pull_requests')
        .find({ project_id: projectId })
        .project({ repository_id: 1 })
        .toArray();
      const byCategory: Record<string, { commits: number; additions: number; deletions: number; pull_requests: number }> = {};
      const bump = (
        category: string,
        patch: Partial<{ commits: number; additions: number; deletions: number; pull_requests: number }>,
      ) => {
        const slot = (byCategory[category] = byCategory[category] || { commits: 0, additions: 0, deletions: 0, pull_requests: 0 });
        slot.commits += patch.commits || 0;
        slot.additions += patch.additions || 0;
        slot.deletions += patch.deletions || 0;
        slot.pull_requests += patch.pull_requests || 0;
      };
      for (const cm of commitRows || []) {
        const meta = catMap.get(String(cm.repository_id || ''));
        bump(meta?.category || 'other', { commits: 1, additions: Number(cm.additions) || 0, deletions: Number(cm.deletions) || 0 });
      }
      for (const p of prRows || []) {
        const meta = catMap.get(String(p.repository_id || ''));
        bump(meta?.category || 'other', { pull_requests: 1 });
      }

      return global.Helpers.makeSuccessServiceStatus('Git metrics fetched.', {
        commits: {
          total: c.commits,
          additions: c.additions,
          deletions: c.deletions,
          files_changed: c.files_changed,
          lines_changed: c.additions + c.deletions,
          authors: (c.authors || []).filter(Boolean).length,
        },
        pull_requests: {
          total: totalPRs,
          by_status: prByStatus,
          merge_rate: totalPRs ? Math.round((merged / totalPRs) * 1000) / 10 : 0,
          avg_reviews_per_pr: totalPRs ? Math.round((weightedReviews / totalPRs) * 10) / 10 : 0,
        },
        daily_activity: daily.map((d: any) => ({ date: d._id, commits: d.commits, additions: d.additions, deletions: d.deletions })),
        by_category: byCategory,
        categories: REPO_CATEGORIES,
      });
    } catch (err: any) {
      this.log('getMetrics', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getActivity
   * @Description: Unified chronological git feed (commits + PRs merged/closed)
   *               with optional `days` window (default 14, max 90).
   */
  public async getActivity(projectId: string, days: number): Promise<IServiceResult> {
    this.initLog();
    this.log('getActivity', ['Request : ', { projectId, days }]);
    try {
      const db = global.db.connection.db!;
      const windowDays = Math.min(Math.max(days || 14, 1), 90);
      const since = new Date(Date.now() - windowDays * 86400000);

      const commits: any[] = await db.collection('commits').find({
        project_id: projectId, committed_at: { $gte: since },
      }).sort({ committed_at: -1 }).limit(100).toArray();

      const prs: any[] = await db.collection('pull_requests').find({
        project_id: projectId,
        $or: [{ merged_at: { $gte: since } }, { closed_at: { $gte: since } }, { created_at: { $gte: since } }],
      }).sort({ created_at: -1 }).limit(100).toArray();

      // Category division: attach the source repo's category to every feed
      // row and roll the feed up per category for the UI's grouped view.
      const catMap = await this.repoCategoryMap(projectId);
      const feed = [
        ...commits.map((c: any) => {
          const meta = catMap.get(String(c.repository_id || ''));
          return {
            type: 'commit', id: c._id, sha: c.sha, message: c.message,
            author: c.author_name || c.author_email, additions: c.additions, deletions: c.deletions,
            category: meta?.category || 'other', repository_name: meta?.repository_name || undefined,
            timestamp: c.committed_at,
          };
        }),
        ...prs.map((p: any) => {
          const meta = catMap.get(String(p.repository_id || ''));
          return {
            type: 'pull_request', id: p._id, number: p.number, title: p.title,
            state: p.state, author: p.user || p.author_name,
            reviews: (p.reviews || []).length,
            category: meta?.category || 'other', repository_name: meta?.repository_name || undefined,
            timestamp: p.created_at,
          };
        }),
      ].sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 200);

      return global.Helpers.makeSuccessServiceStatus('Git activity fetched.', {
        window_days: windowDays,
        counts: {
          commits: commits.length,
          pull_requests: prs.length,
          total: feed.length,
        },
        rows: feed,
        by_category: this.categoryRollup(feed),
        categories: REPO_CATEGORIES,
      });
    } catch (err: any) {
      this.log('getActivity', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }
}
