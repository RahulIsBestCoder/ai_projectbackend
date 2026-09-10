import { Request, Response } from 'express';
import { IntegrationService } from '../service/integration_service';
import { IIntegrationCreate, IIntegrationUpdate } from '../interface/integration_interface';

/**
 * `IntegrationController` – Handles integration CRUD and settings.
 */
export class IntegrationController {
  private readonly _service = new IntegrationService();

  private initLog(): void {
    /* parity with plan convention */
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: createIntegration
   */
  public createIntegration = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `createIntegration${global.Helpers.getTraceID(req.body)}`;
    try {
      const param: IIntegrationCreate = req.body;
      const ret = await this._service.createIntegration(param);
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
   * @Function: getIntegration
   */
  public getIntegration = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getIntegration${global.Helpers.getTraceID(req.params)}`;
    try {
      const id = req.params.id;
      const ret = await this._service.getIntegration(id);
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
   * @Function: updateIntegration
   */
  public updateIntegration = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `updateIntegration${global.Helpers.getTraceID(req.body)}`;
    try {
      const id = req.params.id;
      const param: IIntegrationUpdate = req.body;
      const ret = await this._service.updateIntegration(id, param);
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
   * @Function: deleteIntegration
   */
  public deleteIntegration = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `deleteIntegration${global.Helpers.getTraceID(req.params)}`;
    try {
      const id = req.params.id;
      const ret = await this._service.deleteIntegration(id);
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

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getSyncHistory
   */
  public getSyncHistory = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getSyncHistory${global.Helpers.getTraceID(req.params)}`;
    try {
      const id = req.params.id;
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
      const ret = await this._service.getSyncHistory(id, page, limit);
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
   * @Developer: Claude
   * @Date: 2026-09-10
   * @Function: syncIntegration
   */
  public syncIntegration = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `syncIntegration${global.Helpers.getTraceID(req.params)}`;
    try {
      const ret = await this._service.syncIntegration(req.params.id);
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
