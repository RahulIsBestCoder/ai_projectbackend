import { Request, Response } from 'express';
import { WorkManagementService } from '../service/work_management_service';
import { IWorkItemCreate, IWorkItemUpdate } from '../interface/work_management_interface';

/**
 * `WorkManagementController` – Handles normalized work-item CRUD (plan §07).
 */
export class WorkManagementController {
  private readonly _service = new WorkManagementService();

  private initLog(): void {
    /* parity with plan convention */
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: createWorkItem
   */
  public createWorkItem = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `createWorkItem${global.Helpers.getTraceID(req.body)}`;
    try {
      const param: IWorkItemCreate = req.body;
      const ret = await this._service.createWorkItem(param);
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
   * @Function: getWorkItem
   */
  public getWorkItem = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getWorkItem${global.Helpers.getTraceID(req.params)}`;
    try {
      const workItemId = req.params.id;
      const ret = await this._service.getWorkItem(workItemId);
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
   * @Function: updateWorkItem
   */
  public updateWorkItem = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `updateWorkItem${global.Helpers.getTraceID(req.body)}`;
    try {
      const workItemId = req.params.id;
      const param: IWorkItemUpdate = req.body;
      const ret = await this._service.updateWorkItem(workItemId, param);
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
   * @Function: deleteWorkItem
   */
  public deleteWorkItem = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `deleteWorkItem${global.Helpers.getTraceID(req.params)}`;
    try {
      const workItemId = req.params.id;
      const ret = await this._service.deleteWorkItem(workItemId);
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
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const ret = await this._service.listByProject(projectId, status, page, limit);
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
