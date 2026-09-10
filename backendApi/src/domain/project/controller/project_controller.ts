import { Request, Response } from 'express';
import { IProjectCreate, IProjectUpdate } from '../interface/project_interface';
import { ProjectService } from '../service/project_service';

/**
 * `ProjectController` – Handles project CRUD and settings.
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
      const ret = await this._service.listProjects(page, limit, organizationId);
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

  public listMembers = this._listChild((id, p, l) => this._service.getProjectMembers(id, p, l));
  public listMilestones = this._listChild((id, p, l) => this._service.getProjectMilestones(id, p, l));
  public listDependencies = this._listChild((id, p, l) => this._service.getProjectDependencies(id, p, l));
  public listReports = this._listChild((id, p, l) => this._service.getProjectReports(id, p, l));
  public listReleases = this._listChild((id, p, l) => this._service.getProjectReleases(id, p, l));
}
