import { Request, Response } from 'express';
import { IntegrationService } from '../service/integration_service';
import { IIntegrationCreate, IIntegrationUpdate } from '../interface/integration_interface';
import { Types } from 'mongoose';
import { withSyncLease } from '../../../helper/github_sync_guard';

/**
 * `IntegrationController` – Handles integration CRUD and settings.
 */
/*
 * @Developer: Sougata Bauri
 * @Date: 2026-09-27
 * @Function: IntegrationController
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
        global.Helpers.badRequestStatusBuild(res, ret.status_message, ret.data_sets);
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
   * @Developer: Sougata Bauri
   * @Date: 2026-09-14
   * @Function: listTaigaTasks
   */
  public listTaigaTasks = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `listTaigaTasks${global.Helpers.getTraceID(req.params)}`;
    try {
      const id = req.params.id;
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 200);
      const toInt = (v: unknown): number | null => {
        const n = parseInt(String(v), 10);
        return Number.isFinite(n) ? n : null;
      };
      const filters = {
        milestone: toInt(req.query.milestone),
        user_story: toInt(req.query.user_story),
        assigned_to: toInt(req.query.assigned_to),
        status: toInt(req.query.status),
        is_closed: req.query.is_closed === 'true' ? true : req.query.is_closed === 'false' ? false : null,
        search: (req.query.search as string) || null,
      };
      const ret = await this._service.listTaigaTasks(id, filters, page, limit);
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
   * @Function: listGithubBranches
   */
  public listGithubBranches = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `listGithubBranches${global.Helpers.getTraceID(req.body)}`;
    try {
      const ret = await this._service.listGithubBranches({
        ...(req.body || {}),
        integrationId: req.params.id,
      } as any);
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
   * @Function: syncIntegration
   */
  public syncIntegration = async (req: Request, res: Response): Promise<void> => {
    console.log('=== [CONTROLLER] syncIntegration - HTTP Request Received ===');
    console.log('    params.id:', req.params.id);
    console.log('    method:', req.method);
    console.log('    url:', req.originalUrl);
    this.initLog();
    const trace = `syncIntegration${global.Helpers.getTraceID(req.params)}`;
    try {
      const run = async () => {
        console.log('=== [CONTROLLER] Calling service.syncIntegration ===');
        const ret = await this._service.syncIntegration(req.params.id, req.body || {});
        console.log('=== [CONTROLLER] Service returned ===');
        console.log('    ret.status:', ret.status);
        console.log('    ret.status_message:', ret.status_message);
        if (ret.status) {
          console.log('=== [CONTROLLER] Sending 200 SUCCESS ===');
          global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
        } else {
          console.log('=== [CONTROLLER] Sending 400 BAD REQUEST ===');
          console.log('    error:', ret.status_message);
          global.Helpers.badRequestStatusBuild(res, ret.status_message);
        }
      };
      // Plain GitHub / Taiga data sync — no AI, no time delay: only in-progress 409 + lease.
      const integration = Types.ObjectId.isValid(req.params.id)
        ? await global.db.connection.db!.collection('integrations').findOne(
          { _id: new Types.ObjectId(req.params.id), is_deleted: false }, { projection: { project_id: 1 } },
        )
        : null;
      if (integration?.project_id) await withSyncLease(res, String(integration.project_id), run);
      else await run();
    } catch (error) {
      console.log('=== [CONTROLLER] UNCAUGHT ERROR ===');
      console.log('    error:', error);
      console.log('    stack:', (error as any).stack);
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };
}
