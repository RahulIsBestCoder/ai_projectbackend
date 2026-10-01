import { Request, Response } from 'express';
import { IProjectCreate, IProjectUpdate } from '../interface/project_interface';
import { ProjectService } from '../service/project_service';
import { withAiSyncGuard, withSyncLease } from '../../../helper/github_sync_guard';

/**
 * `ProjectController` â€“ Handles project CRUD and settings.
 */
/*
 * @Developer: Sougata Bauri
 * @Date: 2026-09-27
 * @Function: ProjectController
 */
export class ProjectController {
  private readonly _service = new ProjectService();

  private initLog(): void {
    /* parity with plan convention */
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: createProject
   */
  public createProject = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `createProject${global.Helpers.getTraceID(req.body)}`;
    try {
      const param: IProjectCreate = req.body;
      const ret = await this._service.createProject(param);
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: getProject
   */
  public getProject = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getProject${global.Helpers.getTraceID(req.params)}`;
    try {
      const projectId = req.params.id;
      const ret = await this._service.getProject(projectId);
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: updateProject
   */
  public updateProject = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `updateProject${global.Helpers.getTraceID(req.body)}`;
    try {
      const projectId = req.params.id;
      const param: IProjectUpdate = req.body;
      const ret = await this._service.updateProject(projectId, param);
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: deleteProject
   */
  public deleteProject = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `deleteProject${global.Helpers.getTraceID(req.params)}`;
    try {
      const projectId = req.params.id;
      const ret = await this._service.deleteProject(projectId);
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: listProjects
   */
  public listProjects = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `listProjects${global.Helpers.getTraceID(req.query)}`;
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const organizationId = req.query.organization_id as string | undefined;
      const requestedScope = String(req.query.archive_scope || 'main').toLowerCase();
      if (!['main', 'archived', 'all'].includes(requestedScope)) {
        global.Helpers.badRequestStatusBuild(res, 'archive_scope must be main, archived, or all.');
        return;
      }
      const ret = await this._service.listProjects(
        page,
        limit,
        organizationId,
        requestedScope as 'main' | 'archived' | 'all'
      );
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };

  /*
   * @Function: getPortfolio
   * @Description: Portfolio cards (GitHub connection, sync cooldown, forecast)
   *   for the authenticated user's own/member projects. `?ids=a,b` limits the
   *   page to specific projects (single-card refresh after AI Sync).
   */
  public getPortfolio = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getPortfolio${global.Helpers.getTraceID(req.query)}`;
    try {
      const userId = req.body?.loginDetails?.verifiedData?.user_id;
      if (!userId) {
        global.Helpers.unauthorizedStatusBuild(res, 'Authorization token missing');
        return;
      }
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
      const ids = typeof req.query.ids === 'string'
        ? req.query.ids.split(',').map(id => id.trim()).filter(Boolean)
        : undefined;
      const ret = await this._service.getPortfolio(userId, { page, limit, ids });
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else if ((ret.data_sets as any)?.code === 'USER_INACTIVE') {
        global.Helpers.forbiddenRequestStatusBuild(res, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };

  /*
   * @Function: getAiDashboard
   * @Description: Portfolio AI dashboard from saved reports. `?ids=a,b` limits
   *   it to specific projects; `/:projectId/ai-dashboard` returns one card.
   */
  public getAiDashboard = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getAiDashboard${global.Helpers.getTraceID(req.query)}`;
    try {
      const userId = req.body?.loginDetails?.verifiedData?.user_id;
      if (!userId) {
        global.Helpers.unauthorizedStatusBuild(res, 'Authorization token missing');
        return;
      }
      const projectId = req.params.projectId;
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
      const ids = projectId
        ? [projectId]
        : typeof req.query.ids === 'string'
          ? req.query.ids.split(',').map(id => id.trim()).filter(Boolean)
          : undefined;
      const ret = await this._service.getAiDashboard(userId, { page, limit, ids });
      const code = (ret.data_sets as any)?.code;
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else if (code === 'USER_INACTIVE') {
        global.Helpers.forbiddenRequestStatusBuild(res, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };

  /*
   * Generic handler factory for project-scoped child listings
   * (members / milestones / dependencies / reports / releases).
   */
  private _listChild =
    (fn: (projectId: string, page: number, limit: number) => Promise<any>) =>
    async (req: Request, res: Response): Promise<void> => {
      this.initLog();
      const trace = `listChild${global.Helpers.getTraceID(req.query)}`;
      try {
        const projectId = req.params.projectId;
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
        const ret = await fn(projectId, page, limit);
        if (ret && ret.status) {
          global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
        } else {
          global.Helpers.badRequestStatusBuild(res, ret ? ret.status_message : 'Something went wrong.');
        }
      } catch (error) {
        global.logs.writelog(trace, error, 'ERROR');
        global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
      }
    };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-11
   * @Function: syncProject
   * @Description: Fan-out sync â€” triggers a sync for every integration
   *   attached to the project (GitHub + Taiga). One call from the UI
   *   refreshes all connected data sources. Best-effort: a failed
   *   integration never blocks the others.
   */
  public syncProject = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `syncProject${global.Helpers.getTraceID(req.params)}`;
    try {
      const body = req.body || {};
      const integrationId = body.integrationId ?? body.integration_id;
      if (integrationId !== undefined && typeof integrationId !== 'string') {
        global.Helpers.badRequestStatusBuild(res, 'integrationId must be a string.');
        return;
      }
      const provider = body.provider;
      if (provider !== undefined && provider !== 'taiga' && provider !== 'github') {
        global.Helpers.badRequestStatusBuild(res, "provider must be 'taiga' or 'github'.");
        return;
      }
      // GitHub / Taiga data sync â€” no AI, no time delay: only in-progress 409 + lease.
      await withSyncLease(res, req.params.projectId, async () => {
        const ret = await this._service.syncProject(req.params.projectId, {
          integrationId,
          provider,
          token: body.token,
          username: body.username,
          password: body.password,
        });
        if (ret.status) {
          global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
        } else {
          global.Helpers.badRequestStatusBuild(res, ret.status_message, ret.data_sets);
        }
      });
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };

  /** Run the complete source-to-AI dashboard assessment pipeline. */
  public refreshAiAssessment = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `refreshAiAssessment${global.Helpers.getTraceID(req.params)}`;
    try {
      const body = req.body || {};
      if (body.sync !== undefined && typeof body.sync !== 'boolean') {
        global.Helpers.badRequestStatusBuild(res, 'sync must be a boolean.');
        return;
      }
      const run = async () => {
        const ret = await this._service.refreshAiAssessment(req.params.projectId, {
          sync: body.sync,
          provider: typeof body.provider === 'string' ? body.provider : undefined,
          model: typeof body.model === 'string' ? body.model : undefined,
        });
        if (ret.status) global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
        else global.Helpers.badRequestStatusBuild(res, ret.status_message, ret.data_sets);
      };
      // Only a refresh that syncs sources (sync defaults to true) is limited by the AI sync cooldown.
      if (body.sync === false) await run();
      else await withAiSyncGuard(res, req.params.projectId, run);
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };

  public listMembers = this._listChild((id, p, l) => this._service.getProjectMembers(id, p, l));
  public listMilestones = this._listChild((id, p, l) => this._service.getProjectMilestones(id, p, l));
  public listDependencies = this._listChild((id, p, l) => this._service.getProjectDependencies(id, p, l));
  public listReports = this._listChild((id, p, l) => this._service.getProjectReports(id, p, l));
  public listReleases = this._listChild((id, p, l) => this._service.getProjectReleases(id, p, l));
}
