import { Request, Response } from 'express';
import { AnalyticsService } from '../service/analytics_service';
import { ISnapshotCreate, ISnapshotUpdate } from '../interface/analytics_interface';

/**
 * `AnalyticsController` – Handles metric-snapshot CRUD (plan §09).
 */
export class AnalyticsController {
  private readonly _service = new AnalyticsService();

  private initLog(): void {
    /* parity with plan convention */
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: createSnapshot
   */
  public createSnapshot = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `createSnapshot${global.Helpers.getTraceID(req.body)}`;
    try {
      const param: ISnapshotCreate = req.body;
      const ret = await this._service.createSnapshot(param);
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
   * @Function: getSnapshot
   */
  public getSnapshot = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getSnapshot${global.Helpers.getTraceID(req.params)}`;
    try {
      const snapshotId = req.params.id;
      const ret = await this._service.getSnapshot(snapshotId);
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
   * @Function: updateSnapshot
   */
  public updateSnapshot = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `updateSnapshot${global.Helpers.getTraceID(req.body)}`;
    try {
      const snapshotId = req.params.id;
      const param: ISnapshotUpdate = req.body;
      const ret = await this._service.updateSnapshot(snapshotId, param);
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
   * @Function: deleteSnapshot
   */
  public deleteSnapshot = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `deleteSnapshot${global.Helpers.getTraceID(req.params)}`;
    try {
      const snapshotId = req.params.id;
      const ret = await this._service.deleteSnapshot(snapshotId);
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
   * @Function: getByProject
   */
  public getByProject = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getByProject${global.Helpers.getTraceID(req.query)}`;
    try {
      const projectId = req.params.projectId;
      const metricType = req.query.metric_type as string | undefined;
      const period = req.query.period as string | undefined;
      const ret = await this._service.getByProject(projectId, metricType, period);
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
   * @Function: getHealth
   */
  public getHealth = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getHealth${global.Helpers.getTraceID(req.params)}`;
    try {
      const ret = await this._service.getProjectHealth(req.params.projectId);
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
   * @Function: getHealthStrategies
   */
  public getHealthStrategies = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getHealthStrategies${global.Helpers.getTraceID(req.params)}`;
    try {
      const ret = await this._service.getHealthStrategies(req.params.projectId);
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
   * @Function: getTrends
   */
  public getTrends = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getTrends${global.Helpers.getTraceID(req.query)}`;
    try {
      const projectId = req.params.projectId;
      const metric = (req.query.metric as string) || 'health';
      const period = (req.query.period as string) || 'daily';
      const days = Number(req.query.days) || 56;
      const ret = await this._service.getTrends(projectId, metric, period, days);
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
