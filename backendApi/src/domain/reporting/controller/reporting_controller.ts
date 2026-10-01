import { Request, Response } from 'express';
import { ReportingService } from '../service/reporting_service';
import { IReportCreate, IReportUpdate } from '../interface/reporting_interface';

/**
 * `ReportingController` – Handles report-definition CRUD (plan §12).
 */
/*
 * @Developer: Sougata Bauri
 * @Date: 2026-09-27
 * @Function: ReportingController
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

  /** Generate a temporary PDF from saved report_data and delete it after streaming. */
  public downloadReport = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `downloadReport${global.Helpers.getTraceID(req.params)}`;
    try {
      const ret = await this._service.prepareReportDownload(req.params.id);
      if (!ret.status) {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
        return;
      }
      const prepared = ret.data_sets as { filePath: string; fileName: string; cleanup: () => Promise<void> };
      let cleanupStarted = false;
      const cleanup = () => {
        if (cleanupStarted) return;
        cleanupStarted = true;
        prepared.cleanup().catch(error => global.logs.writelog(trace, error, 'ERROR'));
      };
      res.once('finish', cleanup);
      res.once('close', cleanup);
      res.download(prepared.filePath, prepared.fileName, error => {
        cleanup();
        if (error && !res.headersSent) {
          global.logs.writelog(trace, error, 'ERROR');
          res.status(500).json({ message: 'Unable to download report PDF.' });
        }
      });
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      if (!res.headersSent) global.Helpers.badRequestStatusBuild(res, 'Unable to download report PDF.');
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
