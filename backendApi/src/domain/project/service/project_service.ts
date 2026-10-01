import { ProjectModel } from '../models/project_model';
import { IServiceResult } from '../../../helper/common_interface';
import { IProjectCreate, IProjectUpdate } from '../interface/project_interface';
import { IntegrationService } from '../../integration/service/integration_service';
import { REPO_CATEGORIES, normalizeRepoCategory } from '../../git_intelligence/interface/git_intelligence_interface';
import mongoose from 'mongoose';
import { AiIntelligenceService } from '../../ai_intelligence/service/ai_intelligence_service';
import { RiskPredictionService } from '../../risk_prediction/service/risk_prediction_service';
import { AnalyticsService } from '../../analytics/service/analytics_service';
import { getAccessibleProjectIds } from '../../../helper/sync_access_middleware';
import {
  computeCentralNextSyncAvailableAt, syncCooldownSeconds,
} from '../../../helper/github_sync_guard';
import { REPORT_DASHBOARD_FIELDS, sumDashboardCards, toDashboardCard } from './ai_dashboard_mapper';

/**
 * `ProjectService` â€“ Business logic for project CRUD and settings.
 */
export class ProjectService {
  private readonly _projectModel = new ProjectModel();
  private readonly _integrationService = new IntegrationService();
  private readonly _aiService = new AiIntelligenceService();
  private readonly _riskService = new RiskPredictionService();
  private readonly _analyticsService = new AnalyticsService();
  private readonly logName = 'project_service';

  private initLog(): void {
    /* parity with plan convention */
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: createProject
   */
  public async createProject(param: IProjectCreate): Promise<IServiceResult> {
    this.initLog();
    this.log('createProject', ['Request : ', param]);
    try {
      const existing = await this._projectModel.findByAny({ name: param.name, organization_id: param.organization_id });
      if (existing) {
        return global.Helpers.makeBadServiceStatus('Project already exists.');
      }
      const newProject = await this._projectModel.addNewRecord(param);
      this.log('Add new project result:', newProject);
      return global.Helpers.makeSuccessServiceStatus('Project created.', newProject);
    } catch (err: any) {
      this.log('createProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: getProject
   */
  public async getProject(projectId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getProject', ['Request : ', projectId]);
    try {
      const project = await this._projectModel.findByAny({ _id: projectId });
      if (!project) {
        return global.Helpers.makeBadServiceStatus('Project not found.');
      }
      return global.Helpers.makeSuccessServiceStatus('Project fetched.', project);
    } catch (err: any) {
      this.log('getProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: updateProject
   */
  public async updateProject(projectId: string, param: IProjectUpdate): Promise<IServiceResult> {
    this.initLog();
    this.log('updateProject', ['Request : ', { projectId, param }]);
    try {
      const updated = await this._projectModel.updateAnyRecord({ _id: projectId }, param);
      this.log('Update project result:', updated);
      return global.Helpers.makeSuccessServiceStatus('Project updated.', updated);
    } catch (err: any) {
      this.log('updateProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: deleteProject
   */
  public async deleteProject(projectId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('deleteProject', ['Request : ', projectId]);
    try {
      const deleted = await this._projectModel.updateAnyRecord({ _id: projectId }, { is_deleted: true });
      this.log('Delete project result:', deleted);
      return global.Helpers.makeSuccessServiceStatus('Project deleted.', deleted);
    } catch (err: any) {
      this.log('deleteProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: listProjects
   */
  public async listProjects(
    page: number = 1,
    limit: number = 20,
    organizationId?: string,
    archiveScope: 'main' | 'archived' | 'all' = 'main'
  ): Promise<IServiceResult> {
    this.initLog();
    this.log('listProjects', ['Request : ', { page, limit, organizationId, archiveScope }]);
    try {
      const filter: any = { is_deleted: false };
      if (organizationId) {
        filter.organization_id = organizationId;
      }
      if (archiveScope === 'archived') {
        filter.status = 4;
      } else if (archiveScope === 'main') {
        filter.status = { $ne: 4 };
      }
      const offset = (page - 1) * limit;
      const projects = await this._projectModel.findSelectiveByAny({
        data: filter,
        attributes: '',
        offset,
        limit,
        sort: { created_at: -1 },
      });
      const total = await this._projectModel.countAllByAny(filter);
      return global.Helpers.makeSuccessServiceStatus('Projects fetched.', {
        rows: projects,
        count: projects.length,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
        total,
      });
    } catch (err: any) {
      this.log('listProjects', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Function: getPortfolio
   * @Description: One card per accessible project. Batched `$in` reads over the
   *   page's project ids (no per-project queries).
   */
  public async getPortfolio(userId: unknown, options: { page: number; limit: number; ids?: string[] }): Promise<IServiceResult> {
    this.initLog();
    this.log('getPortfolio', ['Request : ', { userId, ...options }]);
    try {
      const db = global.db.connection.db!;
      const accessible = await getAccessibleProjectIds(db, userId);
      if (!accessible) {
        return { ...global.Helpers.makeBadServiceStatus('Active user required.'), data_sets: { code: 'USER_INACTIVE' } };
      }
      const wanted = options.ids ? new Set(options.ids) : null;
      const scopedIds = wanted ? accessible.filter(id => wanted.has(id)) : accessible;
      const { page, limit } = options;
      const filter = {
        _id: { $in: scopedIds.map(id => new mongoose.Types.ObjectId(id)) },
        is_deleted: false,
      };
      const [projects, total] = await Promise.all([
        db.collection('projects').find(filter)
          .project({ name: 1, status: 1, progress: 1, data_refreshed_at: 1, github_sync_lock_until: 1, central_ai_sync_last_at: 1 })
          .sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
        db.collection('projects').countDocuments(filter),
      ]);

      const pageIds = projects.map(project => String(project._id));
      const now = new Date();
      const [integrations, lockedRepositories, predictions] = pageIds.length ? await Promise.all([
        // All providers: keeps the newest per-project sync time for the card's "last synced".
        db.collection('integrations').find({ project_id: { $in: pageIds }, is_deleted: false })
          .project({ project_id: 1, provider: 1, sync_status: 1, last_sync_at: 1 }).toArray(),
        db.collection('github_repositories').find({ projectId: { $in: pageIds }, lockUntil: { $gt: now } })
          .project({ projectId: 1 }).toArray(),
        db.collection('risk_predictions').find({
          project_id: { $in: pageIds }, kind: 'prediction', risk_key: 'deadline', is_deleted: { $ne: true },
        }).project({
          project_id: 1, on_time_probability: 1, risk_level: 1, predicted_date: 1, forecast_status: 1, updated_at: 1,
        }).toArray(),
      ]) : [[], [], []];

      const integrationsByProject = new Map<string, any[]>();
      for (const integration of integrations) {
        const key = String(integration.project_id);
        integrationsByProject.set(key, [...(integrationsByProject.get(key) || []), integration]);
      }
      const syncingProjects = new Set(lockedRepositories.map(repository => String(repository.projectId)));
      const predictionByProject = new Map(predictions.map(prediction => [String(prediction.project_id), prediction]));

      const rows = projects.map(project => {
        const id = String(project._id);
        const projectIntegrations = integrationsByProject.get(id) || [];
        const github = projectIntegrations.filter(integration => integration.provider === 'github');
        const newest = github
          .filter(integration => integration.last_sync_at)
          .sort((a, b) => new Date(b.last_sync_at).getTime() - new Date(a.last_sync_at).getTime())[0];
        const syncing = syncingProjects.has(id)
          || (project.github_sync_lock_until && new Date(project.github_sync_lock_until) > now);
        const centralNextSyncAvailableAt = computeCentralNextSyncAvailableAt(project, now);
        const prediction: any = predictionByProject.get(id);
        return {
          project_id: id,
          name: project.name,
          status: project.status ?? null,
          progress: project.progress ?? 0,
          data_refreshed_at: project.data_refreshed_at ?? null,
          github: { connected: github.length > 0, repository_count: github.length },
          sync: {
            status: syncing ? 'syncing' : newest?.sync_status || 'idle',
            last_synced_at: newest?.last_sync_at ?? null,
            // Plain GitHub/Taiga data syncs carry no time delay â€” only AI Sync (central) does.
            next_sync_available_at: null,
            cooldown_seconds: 0,
            central_next_sync_available_at: centralNextSyncAvailableAt ? centralNextSyncAvailableAt.toISOString() : null,
            central_cooldown_seconds: syncCooldownSeconds('central'),
          },
          forecast: {
            on_time_probability: prediction?.on_time_probability ?? null,
            risk_level: prediction?.risk_level ?? null,
            predicted_date: prediction?.predicted_date ?? null,
            forecast_status: prediction?.forecast_status ?? null,
            updated_at: prediction?.updated_at ?? null,
          },
        };
      });

      return global.Helpers.makeSuccessServiceStatus('Portfolio fetched.', {
        rows,
        count: rows.length,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
        total,
      });
    } catch (err: any) {
      this.log('getPortfolio', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Function: getAiDashboard
   * @Description: Dashboard cards built only from each project's latest saved
   *   report (no AI calls). Totals cover every scoped project; rows are paged.
   */
  public async getAiDashboard(userId: unknown, options: { page: number; limit: number; ids?: string[] }): Promise<IServiceResult> {
    this.initLog();
    this.log('getAiDashboard', ['Request : ', { userId, ...options }]);
    try {
      const db = global.db.connection.db!;
      const accessible = await getAccessibleProjectIds(db, userId);
      if (!accessible) {
        return { ...global.Helpers.makeBadServiceStatus('Active user required.'), data_sets: { code: 'USER_INACTIVE' } };
      }
      const wanted = options.ids ? new Set(options.ids) : null;
      const scopedIds = wanted ? accessible.filter(id => wanted.has(id)) : accessible;
      if (wanted && !scopedIds.length) {
        return { ...global.Helpers.makeBadServiceStatus('Project not found.'), data_sets: { code: 'PROJECT_NOT_FOUND' } };
      }

      const projects = scopedIds.length ? await db.collection('projects')
        .find({ _id: { $in: scopedIds.map(id => new mongoose.Types.ObjectId(id)) }, is_deleted: false })
        .project({ name: 1, status: 1, report_data_changed_at: 1 })
        .sort({ created_at: -1 }).toArray() : [];
      const projectIds = projects.map(project => String(project._id));

      const reportProjection: Record<string, 1> = { project_id: 1, name: 1, status: 1, generated_at: 1, updated_at: 1 };
      for (const field of REPORT_DASHBOARD_FIELDS) reportProjection[`report_data.${field}`] = 1;
      const reports = projectIds.length ? await db.collection('reports').aggregate([
        // Sprint reports have their own completion percentage. They must never
        // replace the latest whole-project report on the portfolio dashboard.
        { $match: {
          project_id: { $in: projectIds },
          is_deleted: { $ne: true },
          report_data: { $ne: null },
          'report_data.report.type': { $ne: 'sprint_review' },
          'definition.report_type': { $ne: 'sprint' },
        } },
        { $project: reportProjection },
        { $sort: { generated_at: -1, updated_at: -1, _id: -1 } },
        { $group: { _id: '$project_id', latest: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$latest' } },
      ]).toArray() : [];
      const reportByProject = new Map(reports.map(report => [String(report.project_id), report]));

      const cards = projects.map(project => toDashboardCard(project, reportByProject.get(String(project._id))));
      const { page, limit } = options;
      const rows = cards.slice((page - 1) * limit, page * limit);

      return global.Helpers.makeSuccessServiceStatus('AI dashboard fetched.', {
        totals: sumDashboardCards(cards),
        rows,
        count: rows.length,
        page,
        limit,
        total_pages: Math.ceil(cards.length / limit),
        total: cards.length,
        computed_at: new Date().toISOString(),
      });
    } catch (err: any) {
      this.log('getAiDashboard', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /* ==================== project-scoped child listings ==================== */

  /*
   * Generic paginated listing of a project-scoped collection. Members/
   * milestones/dependencies/reports/releases have no dedicated domain
   * models yet, so raw collections are used (same pattern as the git
   * intelligence service for commits/PRs).
   */
  private async _listProjectCollection(
    method: string,
    collection: string,
    label: string,
    projectId: string,
    page: number,
    limit: number,
    sort: any = { created_at: -1 },
  ): Promise<IServiceResult> {
    this.initLog();
    this.log(method, ['Request : ', { projectId, page, limit }]);
    try {
      const project = await this._projectModel.findByAny({ _id: projectId, is_deleted: false });
      if (!project) {
        return global.Helpers.makeBadServiceStatus('Project not found.');
      }
      const db = global.db.connection.db!;
      const col = db.collection(collection);
      const filter = { project_id: projectId, is_deleted: { $ne: true } };
      const offset = (page - 1) * limit;
      const [rows, total] = await Promise.all([
        col.find(filter).sort(sort).skip(offset).limit(limit).toArray(),
        col.countDocuments(filter),
      ]);
      return global.Helpers.makeSuccessServiceStatus(`${label} fetched.`, {
        rows,
        count: rows.length,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
        total,
      });
    } catch (err: any) {
      this.log(method, err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  public async getProjectMembers(projectId: string, page: number, limit: number): Promise<IServiceResult> {
    const rows = await this._listProjectCollection('getProjectMembers', 'project_members', 'Project members', projectId, page, limit, { joined_at: -1 });
    // enrich with user info for convenience
    if (!rows.status) return rows;
    const db = global.db.connection.db!;
    const data: any = rows.data_sets;
    const userIds = data.rows.map((r: any) => r.user_id).filter(Boolean);
    if (userIds.length) {
      const users = await db.collection('users')
        .find({ _id: { $in: userIds.map((u: string) => new mongoose.Types.ObjectId(u)) } })
        .project({ full_name: 1, email: 1, avatar_url: 1, role: 1 })
        .toArray();
      const byId = new Map(users.map((u: any) => [String(u._id), u]));
      data.rows = data.rows.map((r: any) => ({ ...r, user: byId.get(String(r.user_id)) || null }));
    }
    return rows;
  }

  public async getProjectMilestones(projectId: string, page: number, limit: number): Promise<IServiceResult> {
    return this._listProjectCollection('getProjectMilestones', 'milestones', 'Milestones', projectId, page, limit, { due_date: 1 });
  }

  public async getProjectDependencies(projectId: string, page: number, limit: number): Promise<IServiceResult> {
    const ret = await this._listProjectCollection('getProjectDependencies', 'dependencies', 'Dependencies', projectId, page, limit, { created_at: -1 });
    if (!ret.status) return ret;
    // resolve depends_on project names
    const db = global.db.connection.db!;
    const data: any = ret.data_sets;
    const ids = data.rows.map((r: any) => r.depends_on_project_id).filter(Boolean);
    if (ids.length) {
      const deps = await db.collection('projects')
        .find({ _id: { $in: ids.map((i: string) => new mongoose.Types.ObjectId(i)) } })
        .project({ name: 1, health_score: 1 })
        .toArray();
      const byId = new Map(deps.map((d: any) => [String(d._id), d]));
      data.rows = data.rows.map((r: any) => ({ ...r, depends_on: byId.get(String(r.depends_on_project_id)) || null }));
    }
    return ret;
  }

  public async getProjectReports(projectId: string, page: number, limit: number): Promise<IServiceResult> {
    return this._listProjectCollection('getProjectReports', 'reports', 'Reports', projectId, page, limit);
  }

  public async getProjectReleases(projectId: string, page: number, limit: number): Promise<IServiceResult> {
    return this._listProjectCollection('getProjectReleases', 'git_releases', 'Releases', projectId, page, limit, { published_at: -1 });
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-11
   * @Function: syncProject
   * @Description: Fan-out sync â€” triggers a sync for every integration
   *   attached to the project (GitHub + Taiga). Best-effort: a failed
   *   integration never blocks the others. Returns a per-integration
   *   roll-up so the UI can show what happened.
   */
  public async syncProject(projectId: string, options: { integrationId?: string; provider?: 'taiga' | 'github'; token?: string; username?: string; password?: string } = {}): Promise<IServiceResult> {
    this.initLog();
    this.log('syncProject', ['Request : ', projectId]);
    try {
      const project = await this._projectModel.findByAny({ _id: projectId, is_deleted: false });
      if (!project) {
        return global.Helpers.makeBadServiceStatus('Project not found.');
      }

      const db = global.db.connection.db!;
      let integrations = await db.collection('integrations')
        .find({ project_id: projectId, is_deleted: false })
        .toArray();

      if (options.integrationId) {
        integrations = integrations.filter(integration => String(integration._id) === options.integrationId);
        if (!integrations.length) return global.Helpers.makeBadServiceStatus('Integration not found for this project.');
      }
      if (options.provider) {
        integrations = integrations.filter(integration => integration.provider === options.provider);
        if (!integrations.length) return global.Helpers.makeBadServiceStatus(`No ${options.provider === 'taiga' ? 'Taiga' : 'GitHub'} integration is connected to this project.`);
      }

      if (integrations.length === 0) {
        return global.Helpers.makeSuccessServiceStatus('No integrations to sync.', {
          project_id: projectId,
          integrations_synced: 0,
          by_category: {},
          categories: REPO_CATEGORIES,
          results: [],
        });
      }

      const results: Array<{ integration_id: string; provider: string; category: string; status: string; items_synced: number; error: string | null; derived_data_refreshed?: boolean }> = [];
      let totalItems = 0;

      for (const integ of integrations) {
        try {
          const ret = await this._integrationService.syncIntegration(String(integ._id), options);
          const items = ret?.data_sets?.items_synced?.total ?? 0;
          totalItems += items;
          results.push({
            integration_id: String(integ._id),
            provider: integ.provider,
            category: normalizeRepoCategory((integ as any).category),
            status: ret.status ? (ret.data_sets?.status || 'success') : 'failed',
            derived_data_refreshed: ret.data_sets?.derived_data_refreshed ?? false,
            items_synced: items,
            error: ret.status ? (ret.data_sets?.warning || null) : (ret.status_message || 'Sync failed'),
          });
        } catch (err: any) {
          results.push({
            integration_id: String(integ._id),
            provider: integ.provider,
            category: normalizeRepoCategory((integ as any).category),
            status: 'failed',
            items_synced: 0,
            error: err?.message || 'Sync failed',
          });
        }
      }

      // Category division for the fan-out roll-up.
      const byCategory: Record<string, number> = {};
      for (const r of results) {
        byCategory[r.category] = (byCategory[r.category] || 0) + 1;
      }
      const failedCount = results.filter(result => result.status === 'failed').length;
      const syncStatus = failedCount === results.length ? 'failed'
        : results.some(result => result.status !== 'success') ? 'partial' : 'success';
      const summary = {
        status: syncStatus,
        project_id: projectId,
        integrations_synced: results.filter(result => result.status !== 'failed').length,
        integrations_attempted: integrations.length,
        total_items_synced: totalItems,
        by_category: byCategory,
        categories: REPO_CATEGORIES,
        results,
      };
      if (syncStatus === 'failed') {
        return { ...global.Helpers.makeBadServiceStatus('All integrations failed to sync.'), data_sets: summary };
      }
      return global.Helpers.makeSuccessServiceStatus(
        syncStatus === 'partial' ? 'Project sync partially completed.' : 'Project sync complete.', summary,
      );
    } catch (err: any) {
      this.log('syncProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /** One-click tab refresh: source sync, combined AI assessment, then persisted risk/forecast. */
  public async refreshAiAssessment(projectId: string, options: { sync?: boolean; provider?: string; model?: string } = {}): Promise<IServiceResult> {
    try {
      const project = await this._projectModel.findByAny({ _id: projectId, is_deleted: false });
      if (!project) return global.Helpers.makeBadServiceStatus('Project not found.');
      const sync = options.sync === false ? null : await this.syncProject(projectId);
      if (sync && !sync.status) return { ...sync, status_message: 'Source sync failed; AI assessment was not saved.' };
      const assessment = await this._aiService.assessProjectHealth(projectId, options.provider, options.model);
      if (!assessment.status) return assessment;
      const risks = await this._riskService.analyzeRisks(projectId, { sync: false, ai: true, provider: options.provider, model: options.model });
      if (!risks.status) return risks;
      const prediction = await this._riskService.predictDeadline(projectId, { sync: false });
      if (!prediction.status) return prediction;
      const context = await this._aiService.rebuildProjectContext(projectId, 'manual');
      if (!context.status) return context;
      const health = await this._analyticsService.getProjectHealth(projectId);
      const forecast = await this._riskService.getCompletionForecast(projectId);
      return global.Helpers.makeSuccessServiceStatus('AI project assessment refreshed.', {
        project_id: projectId, source_sync: sync?.data_sets || null,
        assessment: assessment.data_sets, health: health.data_sets,
        completion_forecast: forecast.data_sets, risks: risks.data_sets,
        deadline_prediction: prediction.data_sets, context_updated: true,
      });
    } catch (err: any) {
      this.log('refreshAiAssessment', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus(err?.message || 'AI assessment refresh failed.');
    }
  }
}
