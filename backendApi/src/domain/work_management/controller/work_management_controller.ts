import { Request, Response } from 'express';
import { WorkManagementService } from '../service/work_management_service';
import { IWorkItemCreate, IWorkItemUpdate } from '../interface/work_management_interface';
import { WORK_ITEM_SOURCES } from '../interface/work_management_source';

/**
 * `WorkManagementController` – Handles normalized work-item CRUD (plan §07).
 */
/*
 * @Developer: Sougata Bauri
 * @Date: 2026-09-27
 * @Function: WorkManagementController
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
      if (param.source != null && !WORK_ITEM_SOURCES.includes(param.source as any)) {
        global.Helpers.badRequestStatusBuild(res, `Unsupported work item source. Allowed values: ${WORK_ITEM_SOURCES.join(', ')}`);
        return;
      }
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
      if (param.source != null && !WORK_ITEM_SOURCES.includes(param.source as any)) {
        global.Helpers.badRequestStatusBuild(res, `Unsupported work item source. Allowed values: ${WORK_ITEM_SOURCES.join(', ')}`);
        return;
      }
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

  /**
   * GET /v1/work-items/source/:source
   *
   * Return work items for a declared source value. Example sources:
   *   - taiga
   *   - manual
   *   - github
   *   - other
   */
  public findBySource = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `findBySource${global.Helpers.getTraceID(req.params)}`;
    try {
      const source = req.params.source;
      if (!WORK_ITEM_SOURCES.includes(source as any)) {
        global.Helpers.badRequestStatusBuild(res, `Unsupported work item source. Allowed values: ${WORK_ITEM_SOURCES.join(', ')}`);
        return;
      }
      const projectId = req.query.project_id as string | undefined;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const ret = await this._service.findBySource(source, projectId, page, limit);
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


  /**
   * GET /v1/work-items/source/taiga
   *
   * Return Taiga-origin work items. Matches either:
   *   - source = 'taiga'
   *   - external_id starting with 'taiga-' (legacy Taiga sync pattern)
   */
  public findTaigaWorkItems = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `findTaigaWorkItems${global.Helpers.getTraceID(req.query)}`;
    try {
      const projectId = req.query.project_id as string | undefined;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const ret = await this._service.findTaigaWorkItems(projectId, page, limit);
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
