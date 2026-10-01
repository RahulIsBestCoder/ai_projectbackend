import { IntegrationModel } from '../models/integration_model';
import { TaigaTaskModel } from '../models/taiga_task_model';
import { IServiceResult } from '../../../helper/common_interface';
import { IIntegrationCreate, IIntegrationSyncCredentials, IIntegrationUpdate, IIntegrationBranchList } from '../interface/integration_interface';
import { ITaigaTaskCreate } from '../interface/taiga_task_interface';
import { REPO_CATEGORIES, normalizeRepoCategory } from '../../git_intelligence/interface/git_intelligence_interface';
import { AiIntelligenceService } from '../../ai_intelligence/service/ai_intelligence_service';
import { GitHubSourceSyncService } from './github_source_sync_service';
import { githubClient } from './github_client';
import { refreshProjectData } from './project_data_refresh';

/**
 * `IntegrationService` – Business logic for integration CRUD and settings.
 */
export class IntegrationService {
  private readonly _integrationModel = new IntegrationModel();
  private readonly _taigaTaskModel = new TaigaTaskModel();
  private readonly _aiService = new AiIntelligenceService();
  private readonly _sourceSync = new GitHubSourceSyncService();
  private readonly logName = 'integration_service';

  private initLog(): void {
    /* parity with plan convention */
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  private publicIntegration(document: any): any {
    if (!document) return document;
    const value = typeof document.toObject === 'function' ? document.toObject() : { ...document };
    // Secrets never leave the server. The Taiga username is not a secret and is
    // returned so the UI can pre-fill the "Edit Auth" form.
    delete value.token;
    delete value.password;
    value.has_token = Boolean(document.token);
    value.has_username = Boolean(document.username);
    value.has_password = Boolean(document.password);
    return value;
  }

  /* Rebuild before returning so an immediate chat request sees fresh memory. */
  private async refreshDerivedData(projectId: string): Promise<void> {
    await refreshProjectData(projectId);
  }

  private async rebuildProjectContextSafe(projectId: string | undefined, trigger: 'git_sync' | 'taiga_sync'): Promise<string | null> {
    if (!projectId) return 'Integration has no project';
    try {
      await this.refreshDerivedData(projectId);
      const result = await this._aiService.rebuildProjectContext(projectId, trigger);
      if (!result.status) throw new Error(result.status_message || 'Project context refresh failed');
      return null;
    } catch (err: any) {
      this.log('rebuildProjectContextSafe', err?.stack || err, 'ERROR');
      return 'Source data imported, but derived data refresh failed. Retry sync to refresh analytics and context.';
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: createIntegration
   */
  public async createIntegration(param: IIntegrationCreate): Promise<IServiceResult> {
    this.initLog();
    this.log('createIntegration', ['Request : ', { provider: param.provider, project_id: param.project_id }]);
    try {
      // Normalize the team/purpose dropdown (unknown values fall back to 'other').
      param.category = normalizeRepoCategory(param.category);
      const existing: any = await this._integrationModel.findByAny({
        project_id: param.project_id,
        provider: param.provider,
        repository_name: param.repository_name,
      });
      if (existing && !existing.is_deleted) {
        return global.Helpers.makeBadServiceStatus('Integration already exists.');
      }
      if (existing && existing.is_deleted) {
        // Revive a previously disconnected integration instead of blocking re-link.
        const revivedToken = param.provider === 'taiga' && param.username && param.password && param.token === undefined
          ? null
          : param.token ?? existing.token;
        await this._integrationModel.updateAnyRecord(
          { _id: existing._id },
          {
            is_deleted: false,
            deleted_at: null,
            project_id: (param as any).project_id ?? existing.project_id,
            repository_url: param.repository_url ?? existing.repository_url,
            token: revivedToken,
            username: param.username ?? existing.username,
            password: param.password ?? existing.password,
            category: param.category ?? existing.category,
            branch: param.branch ?? existing.branch,
            status: param.status ?? 1,
            sync_status: 'idle',
            updated_at: new Date(),
          },
        );
        const revived = await this._integrationModel.findByAny({ _id: existing._id });
        return global.Helpers.makeSuccessServiceStatus('Integration re-linked.', this.publicIntegration(revived));
      }
      const newInt = await this._integrationModel.addNewRecord(param);
      this.log('Add new integration result:', String(newInt._id));
      return global.Helpers.makeSuccessServiceStatus('Integration created.', this.publicIntegration(newInt));
    } catch (err: any) {
      this.log('createIntegration', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: getIntegration
   */
  public async getIntegration(id: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getIntegration', ['Request : ', id]);
    try {
      const int = await this._integrationModel.findByAny({ _id: id });
      if (!int) {
        return global.Helpers.makeBadServiceStatus('Integration not found.');
      }
      return global.Helpers.makeSuccessServiceStatus('Integration fetched.', this.publicIntegration(int));
    } catch (err: any) {
      this.log('getIntegration', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: updateIntegration
   */
  public async updateIntegration(id: string, param: IIntegrationUpdate): Promise<IServiceResult> {
    this.initLog();
    this.log('updateIntegration', ['Request : ', { id }]);
    try {
      const existing: any = await this._integrationModel.findByAny({ _id: id, is_deleted: false });
      if (!existing) return global.Helpers.makeBadServiceStatus('Integration not found.');
      // Keep only known editable fields so callers cannot tamper with
      // internal bookkeeping (sync_status, is_deleted, timestamps, etc.).
      const allowed = [
        'provider',
        'repository_name',
        'repository_organization',
        'repository_url',
        'project_id',
        'branch',
        'category',
        'token',
        'username',
        'password',
        'status',
      ];
      const patch: Record<string, any> = {};
      for (const key of allowed) {
        if ((param as any)[key] !== undefined) patch[key] = (param as any)[key];
      }
      // Credentials supersede a cached Taiga token. Clear it so the next sync
      // authenticates with the newly supplied username/password.
      if (existing.provider === 'github' && (patch.username !== undefined || patch.password !== undefined)) {
        return global.Helpers.makeBadServiceStatus('GitHub integrations accept token credentials only.');
      }
      if (existing.provider === 'taiga' && (patch.username !== undefined || patch.password !== undefined)) {
        // Credential edits may be partial — an omitted field keeps its stored
        // value, so the UI can pre-fill the username and leave the password
        // blank to keep the stored one (the API never returns the password).
        if (patch.username !== undefined && (typeof patch.username !== 'string' || !patch.username.trim())) {
          return global.Helpers.makeBadServiceStatus('Taiga username cannot be empty.');
        }
        if (patch.password !== undefined && (typeof patch.password !== 'string' || !patch.password.trim())) {
          return global.Helpers.makeBadServiceStatus('Taiga password cannot be empty.');
        }
        if (patch.username === undefined && !existing.username) {
          return global.Helpers.makeBadServiceStatus('A Taiga username is required when none is stored.');
        }
        if (patch.password === undefined && !existing.password) {
          return global.Helpers.makeBadServiceStatus('A Taiga password is required when none is stored.');
        }
        // Only a changed credential makes the cached API token stale.
        const usernameChanged = typeof patch.username === 'string' && patch.username !== String(existing.username || '');
        const passwordChanged = typeof patch.password === 'string' && patch.password !== String(existing.password || '');
        if (usernameChanged || passwordChanged) patch.token = null;
      }
      // Normalize the team/purpose dropdown (unknown values fall back to 'other').
      if (patch.category !== undefined) patch.category = normalizeRepoCategory(patch.category);
      if (Object.keys(patch).length === 0) {
        return global.Helpers.makeBadServiceStatus('Nothing to update.');
      }
      patch.updated_at = new Date();
      await this._integrationModel.updateAnyRecord({ _id: id }, patch);
      // Return the fresh document so the UI sees the new values (token,
      // category, repository, etc.) reflected immediately.
      const updated = await this._integrationModel.findByAny({ _id: id });
      if (!updated) {
        return global.Helpers.makeBadServiceStatus('Integration not found.');
      }
      this.log('Update integration result:', id);
      return global.Helpers.makeSuccessServiceStatus('Integration updated.', this.publicIntegration(updated));
    } catch (err: any) {
      this.log('updateIntegration', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: deleteIntegration
   */
  public async deleteIntegration(id: string): Promise<IServiceResult> {
    this.initLog();
    this.log('deleteIntegration', ['Request : ', id]);
    try {
      const deleted = await this._integrationModel.updateAnyRecord({ _id: id }, { is_deleted: true });
      this.log('Delete integration result:', deleted);
      return global.Helpers.makeSuccessServiceStatus('Integration deleted.', deleted);
    } catch (err: any) {
      this.log('deleteIntegration', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  public async listGithubBranches(param: IIntegrationBranchList): Promise<IServiceResult> {
    this.initLog();
    try {
      let owner = String((param as any).owner || '').trim();
      let repo = String(param.repositoryName || param.repository_name || '').trim();
      let token = typeof param.token === 'string' ? param.token.trim() : '';
      let defaultBranch: string | null = null;
      const repoUrl = String(param.repository_url || '').trim();

      if (param.integrationId) {
        const integ: any = await this._integrationModel.findByAny({ _id: param.integrationId, is_deleted: false });
        if (!integ) return global.Helpers.makeBadServiceStatus('Integration not found.');
        if (integ.provider !== 'github') return global.Helpers.makeBadServiceStatus('Branch listing is available for GitHub integrations only.');
        const fromUrl = String(integ.repository_url || '').match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i);
        if (fromUrl) {
          owner = owner || fromUrl[1];
          repo = repo || fromUrl[2];
        } else {
          const parts = String(integ.repository_name || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
          if (parts.length >= 2) {
            owner = owner || parts[parts.length - 2];
            repo = repo || parts[parts.length - 1];
          }
        }
        if (!token) token = String(integ.token || '');
        defaultBranch = integ.branch ? String(integ.branch) : null;
      } else {
        if (!owner && repo.includes('/')) {
          const parts = repo.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
          if (parts.length >= 2) {
            owner = parts[parts.length - 2];
            repo = parts[parts.length - 1];
          }
        }
        if (!owner && repoUrl) {
          const fromUrl = repoUrl.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i);
          if (fromUrl) {
            owner = owner || fromUrl[1];
            repo = repo || fromUrl[2];
          }
        }
      }

      if (!owner || !repo) {
        return global.Helpers.makeBadServiceStatus('Set repository to "owner/repo" so branches can be listed.');
      }
      if (!token) {
        return global.Helpers.makeBadServiceStatus('A GitHub access token is required to list branches.');
      }

      const gh = githubClient(owner, repo, token);
      let repoMeta: any = null;
      try {
        repoMeta = await gh('');
        if (!defaultBranch && repoMeta?.default_branch) defaultBranch = String(repoMeta.default_branch);
      } catch {
        repoMeta = null;
      }
      const rows: any[] = [];
      for (let page = 1; ; page += 1) {
        const batch: any = await gh(`/branches?per_page=100&page=${page}`);
        if (!Array.isArray(batch)) throw new Error('Unexpected GitHub branches response.');
        rows.push(...batch);
        if (batch.length < 100 || page >= 10) break;
      }
      const branches = rows
        .map((b: any) => ({ name: String(b?.name || ''), protected: Boolean(b?.protected) }))
        .filter((b: any) => b.name);
      return global.Helpers.makeSuccessServiceStatus('Branches fetched.', {
        owner,
        repository_name: `${owner}/${repo}`,
        default_branch: defaultBranch || repoMeta?.default_branch || null,
        branches,
        count: branches.length,
      });
    } catch (err: any) {
      this.log('listGithubBranches', err?.stack || err, 'ERROR');
      const statusCode = (err as any)?.statusCode;
      if (statusCode === 401 || statusCode === 403) {
        return global.Helpers.makeBadServiceStatus('GitHub rejected the token — check it has "repo" scope.');
      }
      if (statusCode === 404) {
        return global.Helpers.makeBadServiceStatus('Repository not found — check the owner/repo name and token access.');
      }
      return global.Helpers.makeBadServiceStatus(err?.message || 'Could not list branches. Please try again later.');
    }
  }

  public async getByProject(projectId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getByProject', ['Request : ', projectId]);
    try {
      const integrations = await this._integrationModel.findAllByAny({ project_id: projectId, is_deleted: false });
      // Group by the team/purpose dropdown and ship the catalog along, so the
      // integration section can render grouped badges AND has the category
      // dropdown options ready whenever the "add repo" form opens.
      const byCategory: Record<string, number> = {};
      for (const r of integrations || []) {
        const key = (r as any).category || 'other';
        byCategory[key] = (byCategory[key] || 0) + 1;
      }
      return global.Helpers.makeSuccessServiceStatus('Integrations fetched.', {
        rows: integrations.map(integration => this.publicIntegration(integration)),
        count: integrations.length,
        by_category: byCategory,
        categories: REPO_CATEGORIES,
      });
    } catch (err: any) {
      this.log('getByProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getSyncHistory
   * @Description: Paginated sync-run history for one integration, with a
   *               success/failure roll-up and the last-sync timestamp.
   */
  public async getSyncHistory(integrationId: string, page: number = 1, limit: number = 20): Promise<IServiceResult> {
    this.initLog();
    this.log('getSyncHistory', ['Request : ', { integrationId, page, limit }]);
    try {
      const integration = await this._integrationModel.findByAny({ _id: integrationId });
      if (!integration) {
        return global.Helpers.makeBadServiceStatus('Integration not found.');
      }

      const db = global.db.connection.db!;
      const filter = { integration_id: integrationId };
      const offset = (page - 1) * limit;
      const rows = await db.collection('sync_history')
        .find(filter)
        .sort({ created_at: -1 })
        .skip(offset)
        .limit(limit)
        .toArray();
      const total = await db.collection('sync_history').countDocuments(filter);

      const stats = await db.collection('sync_history').aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            items: { $sum: { $ifNull: ['$items_synced', 0] } },
            avg_duration_ms: { $avg: { $ifNull: ['$duration_ms', 0] } },
            last_run: { $max: '$created_at' },
          },
        },
      ]).toArray();

      const byStatus: Record<string, number> = {};
      for (const s of stats) {
        byStatus[String(s._id)] = s.count;
      }
      const success = stats.find((s: any) => s._id === 'success');
      const failed = stats.find((s: any) => s._id === 'failed' || s._id === 'error');
      const partial = stats.find((s: any) => s._id === 'partial');
      const round1 = (n: number) => Math.round(n * 10) / 10;

      return global.Helpers.makeSuccessServiceStatus('Sync history fetched.', {
        rows,
        count: rows.length,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
        total,
        // Category division: which repo category these sync runs belong to.
        category: normalizeRepoCategory((integration as any).category),
        stats: {
          total_runs: total,
          by_status: byStatus,
          success_runs: success ? success.count : 0,
          partial_runs: partial ? partial.count : 0,
          failed_runs: failed ? failed.count : 0,
          total_items_synced: (success ? success.items : 0) + (failed ? failed.items : 0) + (partial ? partial.items : 0),
          avg_duration_ms: round1(stats.length ? stats.reduce((a: number, s: any) => a + s.avg_duration_ms * s.count, 0) / (total || 1) : 0),
          last_sync_at: success && success.last_run ? success.last_run : (failed && failed.last_run ? failed.last_run : null),
        },
      });
    } catch (err: any) {
      this.log('getSyncHistory', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-14
   * @Function: listTaigaTasks
   * @Description: Read-side for the dedicated `taiga_tasks` mirror collection.
   *               Populated during `POST /v1/integrations/:id/sync`. Serves the
   *               Taiga-style task status UI with filters (milestone, user story,
   *               assignee, status, closed state, text search), board ordering
   *               (us_order / taskboard_order) and a status roll-up for chips.
   */
  public async listTaigaTasks(
    integrationId: string,
    filters: {
      milestone?: number | null;
      user_story?: number | null;
      assigned_to?: number | null;
      status?: number | null;
      is_closed?: boolean | null;
      search?: string | null;
    } = {},
    page: number = 1,
    limit: number = 100,
  ): Promise<IServiceResult> {
    this.initLog();
    this.log('listTaigaTasks', ['Request : ', { integrationId, filters, page, limit }]);
    try {
      const integration = await this._integrationModel.findByAny({ _id: integrationId });
      if (!integration) {
        return global.Helpers.makeBadServiceStatus('Integration not found.');
      }

      const db = global.db.connection.db!;
      const mirrorFilter = { integration_id: integrationId, is_deleted: { $ne: true }, taiga_task_id: { $ne: null } };
      const filter: Record<string, unknown> = { ...mirrorFilter };
      if (filters.milestone != null) filter.taiga_milestone_id = filters.milestone;
      if (filters.user_story != null) filter.user_story_id = filters.user_story;
      if (filters.assigned_to != null) filter.assigned_to_id = filters.assigned_to;
      if (filters.status != null) filter.status = filters.status;
      if (filters.is_closed != null) filter.is_closed = filters.is_closed;
      if (filters.search && String(filters.search).trim()) {
        filter.subject = { $regex: String(filters.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      }

      const offset = (page - 1) * limit;
      // Board order first (taskboard_order), then user-story order (us_order), then ref.
      const rows = await db.collection('taiga_tasks')
        .find(filter)
        .sort({ taskboard_order: 1, us_order: 1, ref: 1 })
        .skip(offset)
        .limit(limit)
        .toArray();
      const total = await db.collection('taiga_tasks').countDocuments(filter);

      // Status roll-up so the UI can render Taiga-style status chips with counts.
      const statusStats = await db.collection('taiga_tasks').aggregate([
        { $match: mirrorFilter },
        {
          $group: {
            _id: { status: '$status', name: '$status_name', color: '$status_color', is_closed: '$is_closed' },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]).toArray();

      const statuses = statusStats.map((s: any) => ({
        status: s._id?.status ?? null,
        name: s._id?.name ?? 'Unknown',
        color: s._id?.color ?? '#70728F',
        is_closed: !!s._id?.is_closed,
        count: s.count,
      }));
      const closedCount = statuses.filter((s: any) => s.is_closed).reduce((a: number, s: any) => a + s.count, 0);
      const totalAll = statuses.reduce((a: number, s: any) => a + s.count, 0);

      // Latest sync timestamp on this integration's task mirror.
      const lastSync = await db.collection('taiga_tasks')
        .find(mirrorFilter)
        .sort({ synced_at: -1 })
        .limit(1)
        .toArray();

      const columns = await db.collection('taiga_task_statuses')
        .find({ project_id: (integration as any).project_id, is_deleted: { $ne: true } })
        .sort({ sort_order: 1 }).toArray();

      const issues = page === 1 ? await db.collection('taiga_issues')
        .find({ integration_id: integrationId, project_id: (integration as any).project_id, is_deleted: { $ne: true } }, {
          projection: { ref: 1, subject: 1, description: 1, status_name: 1, is_closed: 1,
            assigned_to_full_name: 1, assigned_to_username: 1 },
        }).sort({ ref: 1 }).toArray() : undefined;

      return global.Helpers.makeSuccessServiceStatus('Taiga tasks fetched.', {
        ...(issues ? { issues } : {}),
        columns: columns.map((column: any) => ({
          id: column.taiga_status_id, name: column.name,
          color: column.color || statuses.find((s: any) => s.status === column.taiga_status_id)?.color,
          is_closed: column.is_closed, sort_order: column.sort_order,
        })),
        rows,
        count: rows.length,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
        total,
        project_id: (integration as any).project_id,
        taiga_project_id: rows.length ? rows[0].taiga_project_id : null,
        taiga_project_slug: rows.length ? rows[0].taiga_project_slug : null,
        last_synced_at: lastSync.length ? lastSync[0].synced_at : null,
        roll_up: {
          total_tasks: totalAll,
          closed_tasks: closedCount,
          open_tasks: totalAll - closedCount,
          statuses,
        },
      });
    } catch (err: any) {
      this.log('listTaigaTasks', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }
  
  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: syncIntegration
   * @Description: Pull data from the provider into the local collections.
   *   GitHub: commits + pull_requests (via the REST API, using the stored token).
   *   Writes a sync_history run and updates the integration's sync_status /
   *   last_sync_at. Upserts are keyed by external id, so re-running is safe.
   */
  public async syncIntegration(integrationId: string, credentials: IIntegrationSyncCredentials = {}): Promise<IServiceResult> {
    console.log('=== 1. syncIntegration ENTRY ===');
    console.log('    integrationId:', integrationId);
    console.log('    started at:', new Date().toISOString());
    this.initLog();
    this.log('syncIntegration', ['Request : ', { integrationId }]);
    const started = Date.now();
    const db = global.db.connection.db!;
    console.log('    db connection:', !!db);

    console.log('=== 2. Fetching integration from DB ===');
    console.log('    query: { _id: ' + integrationId + ', is_deleted: false }');
    let integ: any = await this._integrationModel.findByAny({ _id: integrationId, is_deleted: false });
    console.log('    integration found:', !!integ);
    if (!integ) {
      console.log('=== 3. EXIT - Integration not found ===');
      return global.Helpers.makeBadServiceStatus('Integration not found.');
    }

    const credentialPatch: Record<string, string | null | Date> = {};
    for (const key of ['token', 'username', 'password'] as const) {
      if (credentials[key] !== undefined) {
        if (typeof credentials[key] !== 'string' || !credentials[key]!.trim()) {
          return global.Helpers.makeBadServiceStatus(`${key} must be a non-empty string when provided.`);
        }
        credentialPatch[key] = credentials[key]!.trim();
      }
    }
    if (Object.keys(credentialPatch).length) {
      if (integ.provider === 'github' && (credentialPatch.username || credentialPatch.password)) {
        return global.Helpers.makeBadServiceStatus('GitHub sync accepts token only.');
      }
      if (integ.provider === 'taiga' && (credentialPatch.username || credentialPatch.password)) {
        if (!credentialPatch.username || !credentialPatch.password) {
          return global.Helpers.makeBadServiceStatus('Taiga username and password must be provided together.');
        }
        credentialPatch.token = null;
      }
      credentialPatch.updated_at = new Date();
      await this._integrationModel.updateAnyRecord({ _id: integrationId, is_deleted: false }, credentialPatch);
      integ = await this._integrationModel.findByAny({ _id: integrationId, is_deleted: false });
    }

    console.log('=== 3. Integration found, validating provider ===');
    console.log('    provider:', integ.provider);
    console.log('    repository_name:', integ.repository_name);
    console.log('    repository_url:', integ.repository_url);
    console.log('    token present:', !!integ.token);
    console.log('    project_id:', integ.project_id);

    const finish = async (status: string, itemsSynced: number, errorMessage: string | null) => {
      console.log('=== 10. finish() - Writing sync_history & updating integration ===');
      console.log('    status:', status);
      console.log('    itemsSynced:', itemsSynced);
      console.log('    errorMessage:', errorMessage);
      await db.collection('sync_history').insertOne({
        integration_id: integrationId,
        project_id: integ.project_id || null,
        status,
        items_synced: itemsSynced,
        duration_ms: Date.now() - started,
        error_message: errorMessage,
        created_at: new Date(),
      });
      await this._integrationModel.updateAnyRecord(
        { _id: integrationId },
        { sync_status: status, last_sync_at: new Date(), updated_at: new Date() },
      );
      console.log('    sync_history inserted, integration updated.');
    };

    try {
      if (integ.provider === 'taiga') {
        console.log('=== 4. Provider is taiga - delegating to syncTaiga ===');
        return await this.syncTaiga(integ, integrationId, db, finish);
      }
      if (integ.provider !== 'github') {
        console.log('=== 4. EXIT - Provider not supported ===');
        console.log('    provider:', integ.provider);
        await finish('failed', 0, 'Unsupported sync provider.');
        return global.Helpers.makeBadServiceStatus(
          `Sync for provider "${integ.provider}" is not supported yet (github, taiga).`,
        );
      }
      if (!integ.token) {
        console.log('=== 4. EXIT - No token ===');
        await finish('failed', 0, 'No access token on the integration.');
        return global.Helpers.makeBadServiceStatus('GitHub sync needs an access token on the integration.');
      }

      console.log('=== 4. Provider is github, token is present ===');

      console.log('=== 5. Resolving owner/repo from repository_url/repository_name ===');
      console.log('    repository_url:', integ.repository_url);
      console.log('    repository_name:', integ.repository_name);
      // ---- resolve owner/repo -----------------------------------------
      const fromUrl = String(integ.repository_url || '').match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i);
      let owner = '';
      let repo = '';
      if (fromUrl) {
        owner = fromUrl[1];
        repo = fromUrl[2];
      } else {
        const parts = String(integ.repository_name || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
        if (parts.length >= 2) {
          owner = parts[parts.length - 2];
          repo = parts[parts.length - 1];
        }
      }
      if (!owner || !repo) {
        console.log('=== 6. EXIT - Could not parse owner/repo ===');
        console.log('    owner:', owner || 'EMPTY');
        console.log('    repo:', repo || 'EMPTY');
        await finish('failed', 0, `Could not parse owner/repo from "${integ.repository_name}".`);
        return global.Helpers.makeBadServiceStatus(
          `Set repository_name to "owner/repo" (got "${integ.repository_name}").`,
        );
      }

      console.log('=== 6. owner/repo resolved ===');
      console.log('    owner:', owner);
      console.log('    repo:', repo);
      console.log('    api base url: https://api.github.com/repos/' + owner + '/' + repo);

      const gh = githubClient(owner, repo, integ.token);

      const fetchPages = async (endpoint: string): Promise<any[]> => {
        const rows: any[] = [];
        // MAX_PAGES=10: 1000-item cap prevents infinite loop + rate-limit burn
        for (let page = 1; page <= 10; page += 1) {
          const batch = await gh(`${endpoint}&page=${page}`);
          if (!Array.isArray(batch)) throw new Error('Unexpected GitHub list response.');
          rows.push(...batch);
          if (batch.length < 100) return rows;
        }
        return rows;
      };

      console.log('=== 8. Fetching commits + pull_requests in parallel ===');
      // Commits must follow the stored sync branch (e.g. `development`).
      // GitHub `GET /commits` without `sha` falls back to the repo default
      // branch, which is why a `development` integration reported 1 commit
      // instead of the 17 visible on that branch.
      const syncBranch: string | null = typeof integ.branch === 'string' && integ.branch.trim()
        ? (integ.branch as string).trim()
        : null;
      if (!syncBranch) {
        await finish('failed', 0, 'No branch is stored on the GitHub integration.');
        return global.Helpers.makeBadServiceStatus('GitHub sync requires the branch provided when the integration was created. Update or reconnect the integration with a branch.');
      }
      const commitsEndpoint = `/commits?sha=${encodeURIComponent(syncBranch)}&per_page=100`;
      console.log('    sync branch:', syncBranch);
      console.log('    commits URL:', commitsEndpoint);
      console.log('    pulls URL: /pulls?state=all&per_page=100&sort=created&direction=desc');
      const [commitsRaw, pullsRaw] = await Promise.all([
        fetchPages(commitsEndpoint),
        fetchPages('/pulls?state=all&per_page=100&sort=created&direction=desc'),
      ]);
      console.log('=== 9. GitHub API responses received ===');
      console.log('    commits count:', Array.isArray(commitsRaw) ? commitsRaw.length : 'N/A');
      console.log('    pull_requests count:', Array.isArray(pullsRaw) ? pullsRaw.length : 'N/A');
      console.log('    commits sample:', JSON.stringify((Array.isArray(commitsRaw) ? commitsRaw[0] : null), null, 2));
      console.log('    pulls sample:', JSON.stringify((Array.isArray(pullsRaw) ? pullsRaw[0] : null), null, 2));

      // Per-commit line stats (additions/deletions/files) need one call each —
      // bounded so we don't burn the rate limit on large histories.
      const STATS_CONCURRENCY = 5;
      const statsBySha: Record<string, { additions: number; deletions: number; files: number }> = {};
      const MAX_STATS_COMMITS = 50; // per-commit GET /commits/{sha} is rate-expensive; cap per sync run
      const shaList = commitsRaw.map((commit: any) => commit.sha).slice(0, MAX_STATS_COMMITS);
      let statsFailures = 0;
      console.log('=== 9b. Fetching per-commit stats ===');
      console.log('    sha count to fetch:', shaList.length);
      console.log('    statistics concurrency:', STATS_CONCURRENCY);
      for (let offset = 0; offset < shaList.length; offset += STATS_CONCURRENCY) {
        await Promise.all(
          shaList.slice(offset, offset + STATS_CONCURRENCY).map(async (sha: string) => {
            try {
              const details: any = await gh(`/commits/${sha}`);
              statsBySha[sha] = {
                additions: details?.stats?.additions ?? 0,
                deletions: details?.stats?.deletions ?? 0,
                files: Array.isArray(details?.files) ? details.files.length : 0,
              };
            } catch {
              statsFailures += 1;
            }
          }),
        );
      }
      console.log('    stats fetched for', Object.keys(statsBySha).length, 'commits');

      const repoName = `${owner}/${repo}`;
      console.log('=== 10. Writing to DB: git_intelligence (repo upsert) ===');
      console.log('    project_id:', integ.project_id);
      console.log('    repoName:', repoName);
      // ---- repo record (git_intelligence) ----------------------------
      const repoUpsert = await db.collection('git_intelligence').findOneAndUpdate(
        { project_id: integ.project_id, provider: 'github', name: repoName },
        {
          $set: {
            repository_url: integ.repository_url || `https://github.com/${repoName}`,
            provider: 'github',
            // Team/purpose chosen in the UI dropdown at connect time — the
            // integration is the source of truth and wins on every sync.
            category: normalizeRepoCategory(integ.category),
            branch: syncBranch,
            integration_id: String(integrationId),
            is_deleted: false,
            deleted_at: null,
            updated_at: new Date(),
          },
          $setOnInsert: {
            project_id: integ.project_id,
            name: repoName,
            repository_id: repoName,
            visibility: 'private',
            created_at: new Date(),
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
      const repoId = String((repoUpsert as any)?.value?._id || (repoUpsert as any)?._id || repoName);
      console.log('    repoId:', repoId);
      console.log('    git_intelligence upserted/returned:', JSON.stringify(repoUpsert, null, 2));

      // ---- commits -------------------------------------------------
      const commitOps = (Array.isArray(commitsRaw) ? commitsRaw : []).map((c: any) => {
        const when = new Date(c?.commit?.author?.date || c?.commit?.committer?.date || Date.now());
        const st = statsBySha[c.sha];
        return {
          updateOne: {
            filter: { project_id: integ.project_id, repository_id: repoId, sha: c.sha },
            update: {
              $set: {
                project_id: integ.project_id,
                repository_id: repoId,
                sha: c.sha,
                message: c?.commit?.message || '',
                author_name: c?.author?.login || c?.commit?.author?.name || '',
                author_email: c?.commit?.author?.email || '',
                ...(st ? {
                  additions: st.additions,
                  deletions: st.deletions,
                  lines_changed: st.additions + st.deletions,
                  files_changed: st.files,
                } : {}),
                branch: syncBranch || undefined,
                committed_at: when,
                created_at: when,
                date: when,
                is_deleted: false,
              },
            },
            upsert: true,
          },
        };
      });

      // ---- pull requests ----------------------------------------
      const prOps = (Array.isArray(pullsRaw) ? pullsRaw : []).map((p: any) => ({
        updateOne: {
          filter: { project_id: integ.project_id, repository_id: repoId, number: p.number },
          update: {
            $set: {
              project_id: integ.project_id,
              repository_id: repoId,
              number: p.number,
              title: p.title || '',
              description: p.body || '',
              status: p.merged_at ? 'merged' : p.state, // open | closed | merged
              author: p?.user?.login || '',
              branch: p?.head?.ref || '',
              target_branch: p?.base?.ref || '',
              created_at: new Date(p.created_at),
              merged_at: p.merged_at ? new Date(p.merged_at) : null,
              closed_at: p.closed_at ? new Date(p.closed_at) : null,
              is_deleted: false,
            },
          },
          upsert: true,
        },
      }));

      console.log('=== 11. Writing to DB: git_commits bulkWrite ===');
      console.log('    commitOps count:', commitOps.length);
      console.log('    project_id:', integ.project_id);
      if (commitOps.length) await db.collection('commits').bulkWrite(commitOps, { ordered: false });
      console.log('    commits bulkWrite complete.');

      console.log('=== 12. Writing to DB: git_pull_requests bulkWrite ===');
      console.log('    prOps count:', prOps.length);
      console.log('    project_id:', integ.project_id);
      if (prOps.length) await db.collection('pull_requests').bulkWrite(prOps, { ordered: false });
      console.log('    pull_requests bulkWrite complete.');

      const sourceSync = await this._sourceSync.sync({
        projectId: integ.project_id, integrationId, branch: integ.branch,
      }, gh);

      const total = commitOps.length + prOps.length;
      const prsForBranch = syncBranch
        ? (Array.isArray(pullsRaw) ? pullsRaw : []).filter((p) => p?.head?.ref === syncBranch || p?.base?.ref === syncBranch).length
        : prOps.length;
      let totals = { commits: commitOps.length, pull_requests: prOps.length, total };
      try {
        const counts = await Promise.all([
          db.collection('commits').countDocuments({ project_id: integ.project_id, repository_id: repoId, is_deleted: false }),
          db.collection('pull_requests').countDocuments({ project_id: integ.project_id, repository_id: repoId, is_deleted: false }),
        ]);
        totals = { commits: counts[0], pull_requests: counts[1], total: counts[0] + counts[1] };
      } catch {
        // keep fetched counts as fallback
      }
      console.log('=== 13. Sync summary ===');
      console.log('    total items synced:', total);
      console.log('    commits:', commitOps.length);
      console.log('    pull_requests:', prOps.length);
      console.log('    prs for branch:', prsForBranch);
      console.log('    stored totals:', JSON.stringify(totals));
      console.log('    duration_ms:', Date.now() - started);
      const refreshError = await this.rebuildProjectContextSafe(integ.project_id, 'git_sync');
      const syncStatus = statsFailures || refreshError ? 'partial' : 'success';
      const warning = [statsFailures ? `Statistics unavailable for ${statsFailures} commits; existing statistics preserved.` : null, refreshError].filter(Boolean).join(' ') || null;
      await finish(syncStatus, total, warning);

      console.log('=== 14. EXIT - SUCCESS ===');
      console.log('    status_message: Sync complete.');
      console.log('    duration_ms:', Date.now() - started);
      return global.Helpers.makeSuccessServiceStatus(warning || 'Sync complete.', {
        status: syncStatus,
        source_sync: sourceSync,
        derived_data_refreshed: !refreshError,
        warning,
        repository_id: repoId,
        category: normalizeRepoCategory(integ.category),
        sync_branch: syncBranch,
        items_synced: {
          commits: commitOps.length,
          pull_requests: prOps.length,
          pull_requests_for_branch: prsForBranch,
          total,
        },
        totals,
      });
    } catch (err: any) {
      this.log('syncIntegration', err?.stack || err, 'ERROR');
      await finish('failed', 0, err?.message || 'Sync failed').catch(() => undefined);
      return global.Helpers.makeBadServiceStatus(err?.message || 'Sync failed.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: authenticateTaiga
   * @Description: Authenticate with Taiga using username/password to get a token.
   *   Taiga's API requires auth even for public boards.
   */
  private async authenticateTaiga(
    username: string,
    password: string,
    base: string,
    _fetch: any,
  ): Promise<string> {
    const r = await _fetch(`${base}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'normal', username, password }),
    });
    if (!r.ok) {
      const b: any = await r.json().catch(() => ({}));
      throw new Error(`Taiga auth ${r.status}: ${b.detail || b._error_message || r.statusText}`);
    }
    const data: any = await r.json();
    if (!data.auth_token) {
      throw new Error('Taiga auth response missing auth_token.');
    }
    return data.auth_token;
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: buildSprintStatusSummary
   * @Description: Map tasks to their status names and count by status.
   *   Returns a summary like { "New": 8, "In Progress": 12, "Closed": 20 }.
   */
  private buildSprintStatusSummary(tasks: any[], taskStatuses: any[]): Record<string, number> {
    const statusMap = new Map<number, string>();
    for (const s of taskStatuses) {
      if (s && typeof s.id === 'number' && s.name) {
        statusMap.set(s.id, s.name);
      }
    }
    const summary: Record<string, number> = {};
    for (const t of tasks) {
      const statusName = statusMap.get(t.status) || `Unknown (${t.status})`;
      summary[statusName] = (summary[statusName] || 0) + 1;
    }
    return summary;
   }
  /**
   * Map a Taiga task API response item to the \	aiga_tasks\ document shape.
   * Only store fields needed for task/project linkage and Taiga-style UI rendering.
   */
  private mapTaigaTaskToDoc(
    projectId: string,
    integrationId: string,
    t: any
  ): ITaigaTaskCreate {
    const ownerExtra = t.owner_extra_info || {};
    const assignedExtra = t.assigned_to_extra_info || {};

    const attachments: any[] = Array.isArray(t.attachments) ? t.attachments : [];

    return {
      project_id: projectId,
      integration_id: integrationId,
      taiga_task_id: t.id,
      taiga_project_id: t.project || t.project_extra_info?.id,
      taiga_project_name: t.project_extra_info?.name,
      taiga_project_slug: t.project_extra_info?.slug,
      taiga_milestone_id: t.milestone || undefined,
      taiga_milestone_slug: t.milestone_slug || undefined,
      user_story_id: t.user_story || undefined,
      user_story_ref: t.user_story_extra_info?.ref,
      user_story_subject: t.user_story_extra_info?.subject,
      ref: t.ref != null ? t.ref : undefined,
      subject: t.subject || '',
      description: t.description || undefined,
      status: t.status,
      status_name: t.status_extra_info?.name,
      status_color: t.status_extra_info?.color,
      is_closed: !!t.is_closed,
      is_blocked: !!t.is_blocked,
      blocked_note: t.blocked_note || undefined,
      owner_id: t.owner != null ? t.owner : undefined,
      owner_username: ownerExtra?.username,
      owner_full_name: ownerExtra?.full_name_display,
      assigned_to_id: t.assigned_to != null ? t.assigned_to : null,
      assigned_to_username: assignedExtra?.username || null,
      assigned_to_full_name: assignedExtra?.full_name_display || null,
      created_date: t.created_date || undefined,
      modified_date: t.modified_date || undefined,
      finished_date: t.finished_date || null,
      due_date: t.due_date || null,
      due_date_status: t.due_date_status || undefined,
      total_comments: t.total_comments != null ? t.total_comments : undefined,
      us_order: t.us_order != null ? t.us_order : undefined,
      taskboard_order: t.taskboard_order != null ? t.taskboard_order : undefined,
      attachments_count: attachments.length,
      tags: Array.isArray(t.tags) ? t.tags.filter((tag: any) => typeof tag === 'string') : undefined,
    };
  }

  private async ensureTaigaTaskIndexes(db: any): Promise<void> {
    const collection = db.collection('taiga_tasks');
    await collection.createIndex({ project_id: 1, integration_id: 1, taiga_task_id: 1 }, { unique: true, background: false });
    await collection.createIndex({ project_id: 1 }, { background: false });
    await collection.createIndex({ integration_id: 1 }, { background: false });
    await collection.createIndex({ taiga_milestone_id: 1 }, { background: false });
    await collection.createIndex({ assigned_to_id: 1 }, { background: false });
    await collection.createIndex({ status: 1, is_closed: 1 }, { background: false });
  }

  private async ensureTaigaIssueIndexes(db: any): Promise<void> {
    const collection = db.collection('taiga_issues');
    // Partial so older seeded rows without taiga_issue_id do not collide on the unique key.
    await collection.createIndex(
      { project_id: 1, integration_id: 1, taiga_issue_id: 1 },
      { unique: true, background: false, partialFilterExpression: { taiga_issue_id: { $exists: true } } },
    );
    await collection.createIndex({ project_id: 1 }, { background: false });
    await collection.createIndex({ owner_username: 1 }, { background: false });
  }

  private async persistTaigaIssues(db: any, projectId: string, integrationId: string, issues: any[]): Promise<void> {
    if (!issues.length) return;
    const now = new Date();
    const toDate = (value: any) => (value ? new Date(value) : null);
    await db.collection('taiga_issues').bulkWrite(issues.map((issue: any) => {
      const owner = issue.owner_extra_info || {};
      const assigned = issue.assigned_to_extra_info || {};
      return {
        updateOne: {
          filter: { project_id: projectId, integration_id: integrationId, taiga_issue_id: issue.id },
          update: {
            $set: {
              project_id: projectId,
              integration_id: integrationId,
              taiga_issue_id: issue.id,
              ref: issue.ref ?? null,
              subject: issue.subject || '',
              description: issue.description || '',
              status: issue.status ?? null,
              status_name: issue.status_extra_info?.name || null,
              is_closed: !!issue.is_closed,
              type: issue.type ?? null,
              severity: issue.severity ?? null,
              priority: issue.priority ?? null,
              owner_id: issue.owner ?? null,
              owner_username: owner.username || null,
              owner_full_name: owner.full_name_display || null,
              assigned_to_id: issue.assigned_to ?? null,
              assigned_to_username: assigned.username || null,
              assigned_to_full_name: assigned.full_name_display || null,
              created_date: toDate(issue.created_date),
              modified_date: toDate(issue.modified_date),
              finished_date: toDate(issue.finished_date),
              tags: Array.isArray(issue.tags) ? issue.tags.filter((tag: any) => typeof tag === 'string') : [],
              updated_at: now,
            },
            $setOnInsert: { is_deleted: false, created_at: now },
          },
          upsert: true,
        },
      };
    }), { ordered: false });

    await db.collection('work_items').bulkWrite(issues.map((issue: any) => ({
      updateOne: {
        filter: { project_id: projectId, external_id: `taiga-issue-${issue.id}` },
        update: {
          $set: {
            project_id: projectId,
            integration_id: integrationId,
            external_id: `taiga-issue-${issue.id}`,
            source: 'taiga',
            title: issue.subject || `Issue #${issue.ref}`,
            description: issue.description || '',
            type: 'bug',
            status: issue.is_closed ? 'done' : 'in_progress',
            priority: 'medium',
            assignee_id: issue.assigned_to != null ? String(issue.assigned_to) : null,
            reporter_id: issue.owner != null ? String(issue.owner) : null,
            reporter_username: issue.owner_extra_info?.username || null,
            story_points: 0,
            updated_at: now,
          },
          $setOnInsert: { is_deleted: false, created_at: now },
        },
        upsert: true,
      },
    })), { ordered: false });
  }

  private async persistTaigaTasks(
    projectId: string,
    integrationId: string,
    taigaTasks: any[]
  ): Promise<void> {
    if (!taigaTasks.length) return;
    const ops = this._taigaTaskModel.buildSyncOps(
      projectId,
      integrationId,
      taigaTasks.map((t) => this.mapTaigaTaskToDoc(projectId, integrationId, t))
    );
    if (ops.length) {
      await global.db.connection.db!.collection('taiga_tasks').bulkWrite(ops, { ordered: false });
    }

   }
  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: syncTaiga
   * @Description: Pull user stories -> work_items and milestones -> sprints from
   *   a Taiga board. Also fetches task statuses, tasks per sprint, and milestone
   *   statistics. Taiga's API requires auth even for public boards, so a
   *   token (Taiga auth/app token, used as Bearer) is mandatory.
   */
  private async syncTaiga(
    integ: any,
    integrationId: string,
    db: any,
    finish: (status: string, itemsSynced: number, errorMessage: string | null) => Promise<void>,
  ): Promise<IServiceResult> {
    const _fetch: any = (globalThis as any).fetch;
    const base = 'https://api.taiga.io/api/v1';

    // Authenticate if no token but username/password provided
    let token = integ.token;
    if (!token && integ.username && integ.password) {
      try {
        token = await this.authenticateTaiga(integ.username, integ.password, base, _fetch);
        await this._integrationModel.updateAnyRecord(
          { _id: integrationId },
          { token, updated_at: new Date() },
        );
      } catch (err: any) {
        await finish('failed', 0, `Taiga authentication failed: ${err?.message || 'unknown error'}`);
        return global.Helpers.makeBadServiceStatus(
          `Taiga authentication failed: ${err?.message || 'unknown error'}`,
        );
      }
    }

    if (!token) {
      await finish('failed', 0, 'No Taiga token or username/password on the integration.');
      return global.Helpers.makeBadServiceStatus(
        'Taiga sync needs an API token or username/password on the integration (Taiga requires auth even for public boards).',
      );
    }

    // slug from repository_url or repository_name (…/project/<slug>)
    const src = String(integ.repository_url || integ.repository_name || '');
    // Handle Taiga URLs like https://tree.taiga.io/project/<slug>/...
    const slugMatch = src.match(/\/project\/([^/]+)/);
    const slug = slugMatch ? slugMatch[1] : src.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).pop() || '';
    if (!slug) {
      await finish('failed', 0, `Could not parse a Taiga slug from "${src}".`);
      return global.Helpers.makeBadServiceStatus(`Set repository_name to the Taiga project slug (got "${src}").`);
    }

    let reauthPromise: Promise<string> | null = null;
    const refreshToken = async (): Promise<string> => {
      if (!integ.username || !integ.password) throw new Error('Taiga token was rejected and no username/password is available to authenticate again.');
      if (!reauthPromise) {
        reauthPromise = (async () => {
          const refreshed = await this.authenticateTaiga(integ.username, integ.password, base, _fetch);
          await this._integrationModel.updateAnyRecord(
            { _id: integrationId },
            { token: refreshed, updated_at: new Date() },
          );
          token = refreshed;
          return refreshed;
        })().finally(() => { reauthPromise = null; });
      }
      return reauthPromise;
    };
    const taigaGet = (path: string, accessToken: string) => _fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'x-disable-pagination': 'True' },
    });
    const tg = async (path: string) => {
      const requestToken = token;
      let r = await taigaGet(path, requestToken);
      if (r.status === 401 && integ.username && integ.password) {
        const refreshed = token !== requestToken ? token : await refreshToken();
        r = await taigaGet(path, refreshed);
      }
      if (!r.ok) {
        const b: any = await r.json().catch(() => ({}));
        throw new Error(`Taiga ${r.status}: ${b?._error_message || b?.detail || r.statusText}`);
      }
      return r.json();
    };

    try {
      const project: any = await tg(`/projects/by_slug?slug=${encodeURIComponent(slug)}`);
      const pid = project?.id;
      if (!pid) throw new Error(`Taiga project "${slug}" not found.`);

      // Ensure taiga_tasks indexes once per sync (best-effort, never blocks the sync)
      try {
        await this.ensureTaigaTaskIndexes(global.db.connection.db!);
      } catch (idxErr: any) {
        this.log('syncTaiga', ['taiga_tasks index warning:', idxErr?.message || idxErr], 'ERROR');
      }
      try {
        await this.ensureTaigaIssueIndexes(db);
      } catch (idxErr: any) {
        this.log('syncTaiga', ['taiga_issues index warning:', idxErr?.message || idxErr], 'ERROR');
      }

      // Fetch user stories, milestones, task statuses, AND tasks in parallel
      // Use the exact Taiga task URL shape you specified:
      // /tasks?include_attachments=1&milestone={milestoneId}&order_by=us_order&project={projectId}&q=
      const [stories, milestones, taskStatuses, tasks, pointCatalog, issues] = await Promise.all([
        tg(`/userstories?project=${pid}`),
        tg(`/milestones?project=${pid}`),
        tg(`/task-statuses?project=${pid}`),
        tg(`/tasks?include_attachments=1&project=${pid}&order_by=us_order&q=`),
        tg(`/points?project=${pid}`),
        tg(`/issues?project=${pid}`),
      ]);
      const points = new Map<string, number>((Array.isArray(pointCatalog) ? pointCatalog : [])
        .filter((p: any) => typeof p.value === 'number' && Number.isFinite(p.value) && p.value >= 0)
        .map((p: any) => [String(p.id), p.value]));
      if (![stories, milestones, taskStatuses, tasks, pointCatalog, issues].every(Array.isArray)) {
        throw new Error('Taiga returned an invalid collection response; sync cannot be considered complete.');
      }
      const storyPoints = (s: any): number => typeof s.total_points === 'number' && Number.isFinite(s.total_points) && s.total_points >= 0
        ? s.total_points : Object.values(s.points || {}).reduce<number>((sum, id) => sum + (points.get(String(id)) ?? 0), 0);

      // Persist every Taiga task into the dedicated taiga_tasks collection
      await this.persistTaigaTasks(integ.project_id, integrationId, Array.isArray(tasks) ? tasks : []);
      await this.persistTaigaIssues(db, integ.project_id, integrationId, issues);

      // Store task statuses in taiga_task_statuses collection
      if (Array.isArray(taskStatuses) && taskStatuses.length > 0) {
        const statusOps = taskStatuses.map((s: any) => ({
          updateOne: {
            filter: { project_id: integ.project_id, taiga_status_id: s.id },
            update: {
              $set: {
                project_id: integ.project_id,
                taiga_status_id: s.id,
                name: s.name,
                color: s.color,
                is_closed: !!s.is_closed,
                sort_order: s.order || 0,
                updated_at: new Date(),
              },
              $setOnInsert: { is_deleted: false, created_at: new Date() },
            },
            upsert: true,
          },
        }));
        await db.collection('taiga_task_statuses').bulkWrite(statusOps, { ordered: false });
      }

      const sprintOps = (Array.isArray(milestones) ? milestones : []).map((m: any) => ({
        updateOne: {
          filter: { project_id: integ.project_id, taiga_milestone_id: m.id },
          update: {
            $set: {
              project_id: integ.project_id,
              name: m.name,
              integration_id: integrationId,
              source: 'taiga',
              goal: '',
              start_date: m.estimated_start ? new Date(m.estimated_start) : null,
              end_date: m.estimated_finish ? new Date(m.estimated_finish) : null,
              status: m.closed ? 'completed' : 'active',
              planned_points: (Array.isArray(stories) ? stories : []).filter((s: any) => s.milestone === m.id).reduce((sum: number, s: any) => sum + storyPoints(s), 0),
              completed_points: (Array.isArray(stories) ? stories : []).filter((s: any) => s.milestone === m.id && s.is_closed).reduce((sum: number, s: any) => sum + storyPoints(s), 0),
              taiga_milestone_id: m.id,
              updated_at: new Date(),
            },
            $setOnInsert: { is_deleted: false, created_at: new Date() },
          },
          upsert: true,
        },
      }));

      const storyOps = (Array.isArray(stories) ? stories : []).map((s: any) => {
        const pts = storyPoints(s);
        return {
          updateOne: {
            filter: { project_id: integ.project_id, external_id: `taiga-us-${s.id}` },
            update: {
              $set: {
                project_id: integ.project_id,
                integration_id: integrationId,
                external_id: `taiga-us-${s.id}`,
                source: 'taiga',
                title: s.subject || `US #${s.ref}`,
                description: s.description || '',
                type: 'story',
                status: s.is_closed ? 'done' : 'in_progress',
                priority: 'medium',
                assignee_id: s.assigned_to != null ? String(s.assigned_to) : null,
                sprint_id: s.milestone != null ? `taiga-ms-${s.milestone}` : null,
                story_points: pts,
                updated_at: new Date(),
              },
              $setOnInsert: { is_deleted: false, created_at: new Date() },
            },
            upsert: true,
          },
        };
      });

      if (sprintOps.length) await db.collection('sprints').bulkWrite(sprintOps, { ordered: false });
      if (storyOps.length) await db.collection('work_items').bulkWrite(storyOps, { ordered: false });

      // Fetch tasks and stats for each milestone, build sprint status summary
      const milestoneList = Array.isArray(milestones) ? milestones : [];
      let totalTasks = 0;
      const sprintSummaryOps: any[] = [];
      const taskOps: any[] = [];

      for (const m of milestoneList) {
        const milestoneId = m.id;
        const [tasks, stats] = await Promise.all([
          tg(`/tasks?include_attachments=1&milestone=${milestoneId}&order_by=us_order&project=${pid}&q=`),
          tg(`/milestones/${milestoneId}/stats`),
        ]);

        const taskList = Array.isArray(tasks) ? tasks : [];
        totalTasks += taskList.length;

        // Persist every Taiga task for this milestone into the dedicated taiga_tasks collection
        await this.persistTaigaTasks(integ.project_id, integrationId, taskList);

        // Store tasks
        for (const t of taskList) {
          taskOps.push({
            updateOne: {
              filter: { project_id: integ.project_id, external_id: `taiga-task-${t.id}` },
              update: {
                $set: {
                  project_id: integ.project_id,
                  integration_id: integrationId,
                  external_id: `taiga-task-${t.id}`,
                  source: 'taiga',
                  taiga_task_id: t.id,
                  title: t.subject || `Task #${t.ref}`,
                  description: t.description || '',
                  type: 'task',
                  status: t.is_closed ? 'done' : 'in_progress',
                  taiga_status_id: t.status,
                  priority: 'medium',
                  assignee_id: t.assigned_to != null ? String(t.assigned_to) : null,
                  sprint_id: `taiga-ms-${milestoneId}`,
                  milestone_id: milestoneId,
                  story_points: 0,
                  updated_at: new Date(),
                },
                $setOnInsert: { is_deleted: false, created_at: new Date() },
              },
              upsert: true,
            },
          });
        }

        // Build sprint status summary
        const statusSummary = this.buildSprintStatusSummary(taskList, taskStatuses);

        // Store sprint summary with stats
        sprintSummaryOps.push({
          updateOne: {
            filter: { project_id: integ.project_id, sprint_name: m.name },
            update: {
              $set: {
                project_id: integ.project_id,
                sprint_name: m.name,
                taiga_milestone_id: milestoneId,
                start_date: m.estimated_start ? new Date(m.estimated_start) : null,
                end_date: m.estimated_finish ? new Date(m.estimated_finish) : null,
                total_tasks: taskList.length,
                completed_tasks: stats?.completed_tasks || 0,
                total_points: stats?.total_points || 0,
                completed_points: stats?.completed_points || 0,
                status_summary: statusSummary,
                stats: stats || {},
                updated_at: new Date(),
              },
              $setOnInsert: { is_deleted: false, created_at: new Date() },
            },
            upsert: true,
          },
        });
      }

      if (taskOps.length) await db.collection('tasks').bulkWrite(taskOps, { ordered: false });
      if (sprintSummaryOps.length) await db.collection('sprint_summaries').bulkWrite(sprintSummaryOps, { ordered: false });

      const total = sprintOps.length + storyOps.length + taskOps.length + sprintSummaryOps.length + issues.length;
      const refreshError = await this.rebuildProjectContextSafe(integ.project_id, 'taiga_sync');
      await finish(refreshError ? 'partial' : 'success', total, refreshError);
      return global.Helpers.makeSuccessServiceStatus(refreshError || 'Sync complete.', {
        status: refreshError ? 'partial' : 'success',
        derived_data_refreshed: !refreshError,
        warning: refreshError,
        items_synced: {
          work_items: storyOps.length,
          sprints: sprintOps.length,
          tasks: totalTasks,
          sprint_summaries: sprintSummaryOps.length,
          task_statuses: Array.isArray(taskStatuses) ? taskStatuses.length : 0,
          issues: issues.length,
          total,
        },
      });
    } catch (err: any) {
      this.log('syncTaiga', err?.stack || err, 'ERROR');
      await finish('failed', 0, err?.message || 'Taiga sync failed').catch(() => undefined);
      return global.Helpers.makeBadServiceStatus(err?.message || 'Taiga sync failed.');
    }
  }
}
