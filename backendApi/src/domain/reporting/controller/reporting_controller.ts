import { Request, Response } from 'express';
import { ReportingService } from '../service/reporting_service';
import { IReportCreate, IReportUpdate } from '../interface/reporting_interface';

/**
 * `ReportingController` – Handles report-definition CRUD (plan §12).
 */
export class ReportingController {
  private readonly _service = new ReportingService();

  private initLog(): void {
    /* parity with plan convention */
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: listReports
   */
  public listReports = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `listReports${global.Helpers.getTraceID(req.query)}`;
    try {
      const ret = await this._service.listReports({
        project_id: req.query.project_id as string | undefined,
        status: req.query.status as string | undefined,
        format: req.query.format as string | undefined,
        page: req.query.page ? parseInt(String(req.query.page), 10) : undefined,
        limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
      });
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
   * @Function: createReport
   */
  public createReport = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `createReport${global.Helpers.getTraceID(req.body)}`;
    try {
      const param: IReportCreate = req.body;
      const ret = await this._service.createReport(param);
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
   * @Function: getReport
   */
  public getReport = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getReport${global.Helpers.getTraceID(req.params)}`;
    try {
      const reportId = req.params.id;
      const ret = await this._service.getReport(reportId);
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
   * @Function: updateReport
   */
  public updateReport = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `updateReport${global.Helpers.getTraceID(req.body)}`;
    try {
      const reportId = req.params.id;
      const param: IReportUpdate = req.body;
      const ret = await this._service.updateReport(reportId, param);
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
   * @Function: deleteReport
   */
  public deleteReport = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `deleteReport${global.Helpers.getTraceID(req.params)}`;
    try {
      const reportId = req.params.id;
      const ret = await this._service.deleteReport(reportId);
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
