import { GitIntelligenceModel } from '../models/git_intelligence_model';
import { IRepositoryCreate, IRepositoryUpdate } from '../interface/git_intelligence_interface';
import { IServiceResult } from '../../../helper/common_interface';

/**
 * `GitIntelligenceService` – Business logic for linked-repository CRUD (plan §06).
 */
export class GitIntelligenceService {
  private readonly _repositoryModel = new GitIntelligenceModel();
  private readonly logName = 'git_intelligence_service';

  private initLog(): void {
    /* parity with plan convention */
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
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
      const existing = await this._repositoryModel.findByAny({ repository_id: param.repository_id, provider: param.provider });
      if (existing) {
        return global.Helpers.makeBadServiceStatus('Repository already exists.');
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
      const updated = await this._repositoryModel.updateAnyRecord({ _id: repositoryId }, param);
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
      return global.Helpers.makeSuccessServiceStatus('Repositories fetched.', {
        rows: repositories,
        count: repositories.length,
      });
    } catch (err: any) {
      this.log('getByProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  public async getCommitsByProject(projectId: string, page: number = 1, limit: number = 20): Promise<IServiceResult> {
    this.initLog();
    this.log('getCommitsByProject', ['Request : ', { projectId, page, limit }]);
    try {
      const offset = (page - 1) * limit;
      const db = global.db.connection.db!;
      const commits = await db.collection('commits').find({ project_id: projectId }).sort({ date: -1 }).skip(offset).limit(limit).toArray();
      const total = await db.collection('commits').countDocuments({ project_id: projectId });
      return global.Helpers.makeSuccessServiceStatus('Commits fetched.', {
        rows: commits, count: commits.length, page, limit,
        total_pages: Math.ceil(total / limit), total,
      });
    } catch (err: any) {
      this.log('getCommitsByProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  public async getPullRequestsByProject(projectId: string, page: number = 1, limit: number = 20): Promise<IServiceResult> {
    this.initLog();
    this.log('getPullRequestsByProject', ['Request : ', { projectId, page, limit }]);
    try {
      const offset = (page - 1) * limit;
      const db = global.db.connection.db!;
      const prs = await db.collection('pull_requests').find({ project_id: projectId }).sort({ created_at: -1 }).skip(offset).limit(limit).toArray();
      const total = await db.collection('pull_requests').countDocuments({ project_id: projectId });
      return global.Helpers.makeSuccessServiceStatus('Pull requests fetched.', {
        rows: prs, count: prs.length, page, limit,
        total_pages: Math.ceil(total / limit), total,
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
      const contributors = await db.collection('commits').aggregate([
        { $match: { project_id: projectId } },
        { $group: { _id: '$author_email', name: { $first: '$author_name' }, commits: { $sum: 1 }, additions: { $sum: '$additions' }, deletions: { $sum: '$deletions' } } },
        { $sort: { commits: -1 } },
      ]).toArray();
      return global.Helpers.makeSuccessServiceStatus('Contributors fetched.', {
        rows: contributors, count: contributors.length,
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

      const feed = [
        ...commits.map((c: any) => ({
          type: 'commit', id: c._id, sha: c.sha, message: c.message,
          author: c.author_name || c.author_email, additions: c.additions, deletions: c.deletions,
          timestamp: c.committed_at,
        })),
        ...prs.map((p: any) => ({
          type: 'pull_request', id: p._id, number: p.number, title: p.title,
          state: p.state, author: p.user || p.author_name,
          reviews: (p.reviews || []).length, timestamp: p.created_at,
        })),
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
      });
    } catch (err: any) {
      this.log('getActivity', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }
}
