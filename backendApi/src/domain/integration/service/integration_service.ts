import { IntegrationModel } from '../models/integration_model';
import { IServiceResult } from '../../../helper/common_interface';
import { IIntegrationCreate, IIntegrationUpdate } from '../interface/integration_interface';

/**
 * `IntegrationService` – Business logic for integration CRUD and settings.
 */
export class IntegrationService {
  private readonly _integrationModel = new IntegrationModel();
  private readonly logName = 'integration_service';

  private initLog(): void {
    /* parity with plan convention */
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: createIntegration
   */
  public async createIntegration(param: IIntegrationCreate): Promise<IServiceResult> {
    this.initLog();
    this.log('createIntegration', ['Request : ', param]);
    try {
      const existing: any = await this._integrationModel.findByAny({
        provider: param.provider,
        repository_name: param.repository_name,
      });
      if (existing && !existing.is_deleted) {
        return global.Helpers.makeBadServiceStatus('Integration already exists.');
      }
      if (existing && existing.is_deleted) {
        // Revive a previously disconnected integration instead of blocking re-link.
        await this._integrationModel.updateAnyRecord(
          { _id: existing._id },
          {
            is_deleted: false,
            deleted_at: null,
            project_id: (param as any).project_id ?? existing.project_id,
            repository_url: param.repository_url ?? existing.repository_url,
            token: param.token ?? existing.token,
            status: param.status ?? 1,
            sync_status: 'idle',
            updated_at: new Date(),
          },
        );
        const revived = await this._integrationModel.findByAny({ _id: existing._id });
        return global.Helpers.makeSuccessServiceStatus('Integration re-linked.', revived);
      }
      const newInt = await this._integrationModel.addNewRecord(param);
      this.log('Add new integration result:', newInt);
      return global.Helpers.makeSuccessServiceStatus('Integration created.', newInt);
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
      return global.Helpers.makeSuccessServiceStatus('Integration fetched.', int);
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
    this.log('updateIntegration', ['Request : ', { id, param }]);
    try {
      const updated = await this._integrationModel.updateAnyRecord({ _id: id }, param);
      this.log('Update integration result:', updated);
      return global.Helpers.makeSuccessServiceStatus('Integration updated.', updated);
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

  public async getByProject(projectId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getByProject', ['Request : ', projectId]);
    try {
      const integrations = await this._integrationModel.findAllByAny({ project_id: projectId, is_deleted: false });
      return global.Helpers.makeSuccessServiceStatus('Integrations fetched.', {
        rows: integrations,
        count: integrations.length,
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
   * @Developer: Claude
   * @Date: 2026-09-10
   * @Function: syncIntegration
   * @Description: Pull data from the provider into the local collections.
   *   GitHub: commits + pull_requests (via the REST API, using the stored token).
   *   Writes a sync_history run and updates the integration's sync_status /
   *   last_sync_at. Upserts are keyed by external id, so re-running is safe.
   */
  public async syncIntegration(integrationId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('syncIntegration', ['Request : ', { integrationId }]);
    const started = Date.now();
    const db = global.db.connection.db!;

    const integ: any = await this._integrationModel.findByAny({ _id: integrationId, is_deleted: false });
    if (!integ) {
      return global.Helpers.makeBadServiceStatus('Integration not found.');
    }

    const finish = async (status: string, itemsSynced: number, errorMessage: string | null) => {
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
    };

    try {
      if (integ.provider === 'taiga') {
        return await this.syncTaiga(integ, integrationId, db, finish);
      }
      if (integ.provider !== 'github') {
        return global.Helpers.makeBadServiceStatus(
          `Sync for provider "${integ.provider}" is not supported yet (github, taiga).`,
        );
      }
      if (!integ.token) {
        await finish('failed', 0, 'No access token on the integration.');
        return global.Helpers.makeBadServiceStatus('GitHub sync needs an access token on the integration.');
      }

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
        await finish('failed', 0, `Could not parse owner/repo from "${integ.repository_name}".`);
        return global.Helpers.makeBadServiceStatus(
          `Set repository_name to "owner/repo" (got "${integ.repository_name}").`,
        );
      }

      const _fetch: any = (globalThis as any).fetch;
      const gh = async (path: string) => {
        const r = await _fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
          headers: {
            Authorization: `Bearer ${integ.token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'aiproject-sync',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        });
        if (!r.ok) {
          const body: any = await r.json().catch(() => ({}));
          throw new Error(`GitHub ${r.status}: ${body?.message || r.statusText} (${owner}/${repo})`);
        }
        return r.json();
      };

      const [commitsRaw, pullsRaw] = await Promise.all([
        gh('/commits?per_page=100'),
        gh('/pulls?state=all&per_page=100&sort=created&direction=desc'),
      ]);

      // Per-commit line stats (additions/deletions/files) need one call each —
      // bounded so we don't burn the rate limit on large histories.
      const STATS_LIMIT = 50;
      const statsBySha: Record<string, { additions: number; deletions: number; files: number }> = {};
      const shaList = (Array.isArray(commitsRaw) ? commitsRaw : []).slice(0, STATS_LIMIT).map((c: any) => c.sha);
      await Promise.all(
        shaList.map(async (sha: string) => {
          try {
            const d: any = await gh(`/commits/${sha}`);
            statsBySha[sha] = {
              additions: d?.stats?.additions ?? 0,
              deletions: d?.stats?.deletions ?? 0,
              files: Array.isArray(d?.files) ? d.files.length : 0,
            };
          } catch {
            /* leave zeros for this sha */
          }
        }),
      );

      // ---- repo record (git_intelligence) ----------------------------
      const repoName = `${owner}/${repo}`;
      const repoUpsert = await db.collection('git_intelligence').findOneAndUpdate(
        { project_id: integ.project_id, provider: 'github', name: repoName },
        {
          $set: {
            repository_url: integ.repository_url || `https://github.com/${repoName}`,
            provider: 'github',
            updated_at: new Date(),
          },
          $setOnInsert: {
            project_id: integ.project_id,
            name: repoName,
            repository_id: repoName,
            visibility: 'private',
            is_deleted: false,
            created_at: new Date(),
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
      const repoId = String((repoUpsert as any)?.value?._id || (repoUpsert as any)?._id || repoName);

      // ---- commits -------------------------------------------------
      const commitOps = (Array.isArray(commitsRaw) ? commitsRaw : []).map((c: any) => {
        const when = new Date(c?.commit?.author?.date || c?.commit?.committer?.date || Date.now());
        const st = statsBySha[c.sha] || { additions: 0, deletions: 0, files: 0 };
        return {
          updateOne: {
            filter: { project_id: integ.project_id, sha: c.sha },
            update: {
              $set: {
                project_id: integ.project_id,
                repository_id: repoId,
                sha: c.sha,
                message: c?.commit?.message || '',
                author_name: c?.author?.login || c?.commit?.author?.name || '',
                author_email: c?.commit?.author?.email || '',
                additions: st.additions,
                deletions: st.deletions,
                lines_changed: st.additions + st.deletions,
                files_changed: st.files,
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
          filter: { project_id: integ.project_id, number: p.number },
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
              additions: 0,
              deletions: 0,
              files_changed: 0,
              reviews: [],
              is_deleted: false,
            },
          },
          upsert: true,
        },
      }));

      if (commitOps.length) await db.collection('commits').bulkWrite(commitOps, { ordered: false });
      if (prOps.length) await db.collection('pull_requests').bulkWrite(prOps, { ordered: false });

      const total = commitOps.length + prOps.length;
      await finish('success', total, null);

      return global.Helpers.makeSuccessServiceStatus('Sync complete.', {
        status: 'success',
        repository_id: repoId,
        items_synced: {
          commits: commitOps.length,
          pull_requests: prOps.length,
          total,
        },
      });
    } catch (err: any) {
      this.log('syncIntegration', err?.stack || err, 'ERROR');
      await finish('failed', 0, err?.message || 'Sync failed').catch(() => undefined);
      return global.Helpers.makeBadServiceStatus(err?.message || 'Sync failed.');
    }
  }

  /*
   * @Developer: Claude
   * @Date: 2026-09-10
   * @Function: syncTaiga
   * @Description: Pull user stories -> work_items and milestones -> sprints from
   *   a Taiga board. Taiga's API requires auth even for public boards, so a
   *   token (Taiga auth/app token, used as Bearer) is mandatory.
   */
  private async syncTaiga(
    integ: any,
    integrationId: string,
    db: any,
    finish: (status: string, itemsSynced: number, errorMessage: string | null) => Promise<void>,
  ): Promise<IServiceResult> {
    if (!integ.token) {
      await finish('failed', 0, 'No Taiga token on the integration.');
      return global.Helpers.makeBadServiceStatus(
        'Taiga sync needs an API token on the integration (Taiga requires auth even for public boards).',
      );
    }

    // slug from repository_url or repository_name (…/project/<slug>)
    const src = String(integ.repository_url || integ.repository_name || '');
    const slug = src.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).pop() || '';
    if (!slug) {
      await finish('failed', 0, `Could not parse a Taiga slug from "${src}".`);
      return global.Helpers.makeBadServiceStatus(`Set repository_name to the Taiga project slug (got "${src}").`);
    }

    const _fetch: any = (globalThis as any).fetch;
    const base = 'https://api.taiga.io/api/v1';
    const tg = async (path: string) => {
      const r = await _fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${integ.token}`, 'Content-Type': 'application/json' },
      });
      if (!r.ok) {
        const b: any = await r.json().catch(() => ({}));
        throw new Error(`Taiga ${r.status}: ${b?._error_message || r.statusText}`);
      }
      return r.json();
    };

    try {
      const project: any = await tg(`/projects/by_slug?slug=${encodeURIComponent(slug)}`);
      const pid = project?.id;
      if (!pid) throw new Error(`Taiga project "${slug}" not found.`);

      const [stories, milestones] = await Promise.all([
        tg(`/userstories?project=${pid}`),
        tg(`/milestones?project=${pid}`),
      ]);

      const sprintOps = (Array.isArray(milestones) ? milestones : []).map((m: any) => ({
        updateOne: {
          filter: { project_id: integ.project_id, name: m.name },
          update: {
            $set: {
              project_id: integ.project_id,
              name: m.name,
              goal: '',
              start_date: m.estimated_start ? new Date(m.estimated_start) : null,
              end_date: m.estimated_finish ? new Date(m.estimated_finish) : null,
              status: m.closed ? 'completed' : 'active',
              planned_points: Number(m.total_points) || 0,
              updated_at: new Date(),
            },
            $setOnInsert: { is_deleted: false, created_at: new Date() },
          },
          upsert: true,
        },
      }));

      const storyOps = (Array.isArray(stories) ? stories : []).map((s: any) => {
        const pts =
          typeof s.total_points === 'number'
            ? s.total_points
            : s.points && typeof s.points === 'object'
              ? Object.values(s.points).reduce((a: number, b: any) => a + (Number(b) || 0), 0)
              : 0;
        return {
          updateOne: {
            filter: { project_id: integ.project_id, external_id: `taiga-us-${s.id}` },
            update: {
              $set: {
                project_id: integ.project_id,
                integration_id: integrationId,
                external_id: `taiga-us-${s.id}`,
                title: s.subject || `US #${s.ref}`,
                description: s.description || '',
                type: 'story',
                status: s.is_closed ? 'done' : 'in_progress',
                priority: 'medium',
                assignee_id: s.assigned_to != null ? String(s.assigned_to) : undefined,
                sprint_id: s.milestone != null ? `taiga-ms-${s.milestone}` : undefined,
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

      const total = sprintOps.length + storyOps.length;
      await finish('success', total, null);
      return global.Helpers.makeSuccessServiceStatus('Sync complete.', {
        status: 'success',
        items_synced: { work_items: storyOps.length, sprints: sprintOps.length, total },
      });
    } catch (err: any) {
      this.log('syncTaiga', err?.stack || err, 'ERROR');
      await finish('failed', 0, err?.message || 'Taiga sync failed').catch(() => undefined);
      return global.Helpers.makeBadServiceStatus(err?.message || 'Taiga sync failed.');
    }
  }
}
