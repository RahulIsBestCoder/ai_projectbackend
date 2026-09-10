import { Request, Response } from 'express';
import { SprintIntelligenceService } from '../service/sprint_intelligence_service';
import { ISprintCreate, ISprintUpdate } from '../interface/sprint_intelligence_interface';

/**
 * `SprintIntelligenceController` – Handles sprint CRUD (plan §08).
 */
export class SprintIntelligenceController {
  private readonly _service = new SprintIntelligenceService();

  private initLog(): void {
    /* parity with plan convention */
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: createSprint
   */
  public createSprint = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `createSprint${global.Helpers.getTraceID(req.body)}`;
    try {
      const param: ISprintCreate = req.body;
      const ret = await this._service.createSprint(param);
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
   * @Function: getSprint
   */
  public getSprint = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getSprint${global.Helpers.getTraceID(req.params)}`;
    try {
      const sprintId = req.params.id;
      const ret = await this._service.getSprint(sprintId);
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
   * @Function: updateSprint
   */
  public updateSprint = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `updateSprint${global.Helpers.getTraceID(req.body)}`;
    try {
      const sprintId = req.params.id;
      const param: ISprintUpdate = req.body;
      const ret = await this._service.updateSprint(sprintId, param);
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
   * @Function: deleteSprint
   */
  public deleteSprint = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `deleteSprint${global.Helpers.getTraceID(req.params)}`;
    try {
      const sprintId = req.params.id;
      const ret = await this._service.deleteSprint(sprintId);
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
   * @Function: listByProject
   */
  public listByProject = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `listByProject${global.Helpers.getTraceID(req.query)}`;
    try {
      const projectId = req.params.projectId;
      const status = req.query.status as string | undefined;
      const ret = await this._service.listByProject(projectId, status);
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
   * @Function: getSprintSummary
   */
  public getSprintSummary = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getSprintSummary${global.Helpers.getTraceID(req.params)}`;
    try {
      const sprintId = req.params.id;
      const ret = await this._service.getSprintSummary(sprintId);
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
   * @Function: getBurndown
   */
  public getBurndown = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getBurndown${global.Helpers.getTraceID(req.params)}`;
    try {
      const ret = await this._service.getBurndown(req.params.id);
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
   * @Function: getBurnup
   */
  public getBurnup = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getBurnup${global.Helpers.getTraceID(req.params)}`;
    try {
      const ret = await this._service.getBurnup(req.params.id);
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
   * @Function: getVelocity
   */
  public getVelocity = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getVelocity${global.Helpers.getTraceID(req.params)}`;
    try {
      const ret = await this._service.getVelocity(req.params.id);
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
   * @Function: getRetrospective
   */
  public getRetrospective = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getRetrospective${global.Helpers.getTraceID(req.params)}`;
    try {
      const ret = await this._service.getRetrospective(req.params.id);
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
