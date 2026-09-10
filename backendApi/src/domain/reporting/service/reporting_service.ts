import { ReportingModel } from '../models/reporting_model';
import { IReportCreate, IReportUpdate } from '../interface/reporting_interface';
import { IServiceResult } from '../../../helper/common_interface';

/**
 * `ReportingService` – Business logic for report-definition CRUD (plan §12).
 */
export class ReportingService {
  private readonly _reportModel = new ReportingModel();
  private readonly logName = 'reporting_service';

  private initLog(): void {
    /* parity with plan convention */
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: createReport
   */
  public async createReport(param: IReportCreate): Promise<IServiceResult> {
    this.initLog();
    this.log('createReport', ['Request : ', param]);
    try {
      const existing = await this._reportModel.findByAny({ project_id: param.project_id, name: param.name });
      if (existing) {
        return global.Helpers.makeBadServiceStatus('Report already exists.');
      }
      const newReport = await this._reportModel.addNewRecord(param);
      this.log('Add new report result:', newReport);
      return global.Helpers.makeSuccessServiceStatus('Report created.', newReport);
    } catch (err: any) {
      this.log('createReport', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: getReport
   */
  public async getReport(reportId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getReport', ['Request : ', reportId]);
    try {
      const report = await this._reportModel.findByAny({ _id: reportId });
      if (!report) {
        return global.Helpers.makeBadServiceStatus('Report not found.');
      }
      return global.Helpers.makeSuccessServiceStatus('Report fetched.', report);
    } catch (err: any) {
      this.log('getReport', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: updateReport
   */
  public async updateReport(reportId: string, param: IReportUpdate): Promise<IServiceResult> {
    this.initLog();
    this.log('updateReport', ['Request : ', { reportId, param }]);
    try {
      const updated = await this._reportModel.updateAnyRecord({ _id: reportId }, param);
      this.log('Update report result:', updated);
      return global.Helpers.makeSuccessServiceStatus('Report updated.', updated);
    } catch (err: any) {
      this.log('updateReport', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: deleteReport
   */
  public async deleteReport(reportId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('deleteReport', ['Request : ', reportId]);
    try {
      const deleted = await this._reportModel.updateAnyRecord({ _id: reportId }, { is_deleted: true });
      this.log('Delete report result:', deleted);
      return global.Helpers.makeSuccessServiceStatus('Report deleted.', deleted);
    } catch (err: any) {
      this.log('deleteReport', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: listReports
   * @Description: Paginated report list with optional project/status/format
   *               filters. Uses the raw collection so seeded fields that are
   *               absent from the mongoose schema (definition, artifact_url)
   *               survive strict-mode projection.
   */
  public async listReports(filters: {
    project_id?: string; status?: string; format?: string; page?: number; limit?: number;
  }): Promise<IServiceResult> {
    this.initLog();
    this.log('listReports', ['Request : ', filters]);
    try {
      const query: any = { is_deleted: false };
      if (filters.project_id) query.project_id = filters.project_id;
      if (filters.status) query.status = filters.status;
      if (filters.format) query.format = filters.format;
      const page = Math.max(1, filters.page || 1);
      const limit = Math.min(100, Math.max(1, filters.limit || 20));
      const db = global.db.connection.db!;
      const collection = db.collection('reports');
      const total = await collection.countDocuments(query);
      const rows = await collection.find(query)
        .sort({ created_at: -1 })
        .skip((page - 1) * limit).limit(limit).toArray();
      return global.Helpers.makeSuccessServiceStatus('Reports fetched.', {
        rows, count: rows.length, page, limit,
        total_pages: Math.ceil(total / limit), total,
      });
    } catch (err: any) {
      this.log('listReports', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }
}
