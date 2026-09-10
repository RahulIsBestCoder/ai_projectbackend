import { Request, Response } from 'express';
import { GitIntelligenceService } from '../service/git_intelligence_service';
import { IRepositoryCreate, IRepositoryUpdate } from '../interface/git_intelligence_interface';

/**
 * `GitIntelligenceController` – Handles linked-repository CRUD (plan §06).
 */
export class GitIntelligenceController {
  private readonly _service = new GitIntelligenceService();

  private initLog(): void {
    /* parity with plan convention */
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: createRepository
   */
  public createRepository = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `createRepository${global.Helpers.getTraceID(req.body)}`;
    try {
      const param: IRepositoryCreate = req.body;
      const ret = await this._service.createRepository(param);
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
   * @Date: 2026-09-04
   * @Function: getRepository
   */
  public getRepository = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getRepository${global.Helpers.getTraceID(req.params)}`;
    try {
      const repositoryId = req.params.id;
      const ret = await this._service.getRepository(repositoryId);
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
   * @Date: 2026-09-04
   * @Function: updateRepository
   */
  public updateRepository = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `updateRepository${global.Helpers.getTraceID(req.body)}`;
    try {
      const repositoryId = req.params.id;
      const param: IRepositoryUpdate = req.body;
      const ret = await this._service.updateRepository(repositoryId, param);
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
   * @Date: 2026-09-04
   * @Function: deleteRepository
   */
  public deleteRepository = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `deleteRepository${global.Helpers.getTraceID(req.params)}`;
    try {
      const repositoryId = req.params.id;
      const ret = await this._service.deleteRepository(repositoryId);
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

  public getByProject = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getByProject${global.Helpers.getTraceID(req.params)}`;
    try {
      const projectId = req.params.projectId;
      const ret = await this._service.getByProject(projectId);
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

  public getCommitsByProject = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getCommitsByProject${global.Helpers.getTraceID(req.query)}`;
    try {
      const projectId = req.params.projectId;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const ret = await this._service.getCommitsByProject(projectId, page, limit);
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

  public getPullRequestsByProject = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getPullRequestsByProject${global.Helpers.getTraceID(req.query)}`;
    try {
      const projectId = req.params.projectId;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const ret = await this._service.getPullRequestsByProject(projectId, page, limit);
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

  public getContributorsByProject = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getContributorsByProject${global.Helpers.getTraceID(req.params)}`;
    try {
      const projectId = req.params.projectId;
      const ret = await this._service.getContributorsByProject(projectId);
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
   * @Function: getMetrics
   */
  public getMetrics = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getMetrics${global.Helpers.getTraceID(req.params)}`;
    try {
      const ret = await this._service.getMetrics(req.params.projectId);
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
   * @Function: getActivity
   */
  public getActivity = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getActivity${global.Helpers.getTraceID(req.query)}`;
    try {
      const projectId = req.params.projectId;
      const days = Number(req.query.days) || 14;
      const ret = await this._service.getActivity(projectId, days);
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
}
