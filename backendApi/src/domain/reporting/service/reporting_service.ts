import { ReportingModel } from '../models/reporting_model';
import { IReportCreate, IReportUpdate } from '../interface/reporting_interface';
import { IServiceResult } from '../../../helper/common_interface';
import { AiIntelligenceService } from '../../ai_intelligence/service/ai_intelligence_service';
import { createHash } from 'crypto';
import { ReportPdfService } from './report_pdf_service';

/**
 * `ReportingService` – Business logic for report-definition CRUD (plan §12).
 */
export class ReportingService {
  public static readonly DEFAULT_SCOPE = ['project', 'analytics', 'risks', 'sprints', 'work_items', 'plan', 'plan_execution', 'repository'];
  private readonly _reportModel = new ReportingModel();
  private readonly _ai = new AiIntelligenceService();
  private readonly _pdf = new ReportPdfService();
  private readonly logName = 'reporting_service';

  private initLog(): void {
    /* parity with plan convention */
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  private stable(value: any): any {
    if (Array.isArray(value)) return value.map(item => this.stable(item));
    if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result: any, key) => {
      if (!['generated_report', 'scope', 'content', 'report_content'].includes(key)) result[key] = this.stable(value[key]);
      return result;
    }, {});
    return value;
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: createReport
   */
  public async createReport(param: IReportCreate): Promise<IServiceResult> {
    this.initLog();
    this.log('createReport', ['Request : ', param]);
    let pendingId: any;
    try {
      const rawDefinition: any = param.definition || {};
      const { period: _period, frequency: _frequency, generated_report: _oldReport, ...definition } = rawDefinition;
      const reportType = param.report_type === 'sprint' ? 'sprint' : 'project';
      const sprintId = reportType === 'sprint' ? String(param.sprint_id || '').trim() : null;
      if (reportType === 'sprint' && !sprintId) return global.Helpers.makeBadServiceStatus('A sprint is required for a sprint report.');
      const scope: string[] = [...ReportingService.DEFAULT_SCOPE].sort();
      const contentValue = param.content ?? param.report_content ?? definition.content ?? definition.report_content ?? '';
      if (typeof contentValue !== 'string' || contentValue.length > 20000) return global.Helpers.makeBadServiceStatus('content must be a string up to 20,000 characters.');
      const reportContent = contentValue.trim() || 'Generate a comprehensive project status and progress report for stakeholders.';
      scope.sort();
      const generationKey = createHash('sha256').update(JSON.stringify({
        project_id: param.project_id,
        format: param.format || 'pdf',
        scope,
        content: reportContent,
        definition: this.stable(definition),
        report_type: reportType,
        sprint_id: sprintId,
      })).digest('hex');
      const existing = await this._reportModel.findByAny({
        project_id: param.project_id, is_deleted: false,
        ...(reportType === 'sprint'
          ? { 'definition.report_type': 'sprint', 'definition.sprint_id': sprintId }
          : { name: param.name, 'definition.report_type': { $ne: 'sprint' } }),
      });
      const storedData = existing?.report_data || existing?.definition?.generated_report;
      if (storedData && existing.status !== 'failed' && !param.force_regenerate && existing.generation_key === generationKey) {
        if (!existing.report_data) await this._reportModel.updateAnyRecord({ _id: existing._id }, {
          report_data: storedData, generation_key: generationKey, generated_at: existing.updated_at || existing.created_at || new Date(),
        });
        const cached = { ...(existing.toObject ? existing.toObject() : existing), report_data: storedData,
          generation_key: generationKey, cache_hit: true };
        return global.Helpers.makeSuccessServiceStatus('Stored report returned.', cached);
      }
      const pendingData = {
        project_id: param.project_id, name: param.name, format: param.format || 'pdf', scope, report_content: reportContent, generation_key: generationKey,
        definition: { ...definition, scope, content: reportContent, report_type: reportType, sprint_id: sprintId }, status: 'generating', updated_at: new Date(),
      };
      let reportRecord: any = existing;
      if (existing) await this._reportModel.updateAnyRecord({ _id: existing._id }, pendingData);
      else reportRecord = await this._reportModel.addNewRecord(pendingData);
      pendingId = reportRecord._id;
      const generated = await this._ai.generateReport(param.project_id, {
        name: param.name,
        format: param.format || 'pdf',
        ...definition,
        scope,
        content: reportContent,
        report_type: reportType,
        sprint_id: sprintId,
      });
      const reportData = {
        ...pendingData,
        report_data: generated,
        generation_key: generationKey,
        generated_at: generated.report?.generatedAt || generated.generated_at || new Date(),
        definition: {
          ...definition,
          scope,
          content: reportContent,
          report_type: reportType,
          sprint_id: sprintId,
          generated_report: generated, // backward-compatible UI location
        },
        status: (generated.report?.generatedBy || generated.generated_by) === 'ai' ? 'generated' : 'generated_with_fallback',
        updated_at: new Date(),
      };
      await this._reportModel.updateAnyRecord({ _id: reportRecord._id }, reportData);
      const completed = { ...(reportRecord.toObject ? reportRecord.toObject() : reportRecord), ...reportData, cache_hit: false };
      this.log('Generated report result:', { id: reportRecord._id, status: reportData.status });
      return global.Helpers.makeSuccessServiceStatus(existing ? 'Existing report regenerated.' : 'Report created.', completed);
    } catch (err: any) {
      this.log('createReport', err?.stack || err, 'ERROR');
      if (pendingId) {
        try { await this._reportModel.updateAnyRecord({ _id: pendingId }, { status: 'failed', updated_at: new Date() }); }
        catch (saveError) { this.log('createReport.failureStatus', saveError, 'ERROR'); }
      }
      return global.Helpers.makeBadServiceStatus('Report generation failed. Retry to generate fresh data; any previous saved report is preserved.');
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
      const report = await this._reportModel.findByAny({ _id: reportId, is_deleted: false });
      if (!report) {
        return global.Helpers.makeBadServiceStatus('Report not found.');
      }
      return global.Helpers.makeSuccessServiceStatus('Report fetched.', report);
    } catch (err: any) {
      this.log('getReport', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /** Render the already-saved report JSON into a temporary PDF download. */
  public async prepareReportDownload(reportId: string): Promise<IServiceResult> {
    this.initLog();
    try {
      const report = await this._reportModel.findByAny({ _id: reportId, is_deleted: false });
      if (!report) return global.Helpers.makeBadServiceStatus('Report not found.');
      if (!report.report_data && !report.definition?.generated_report) {
        return global.Helpers.makeBadServiceStatus('Generate this report before downloading it.');
      }
      const prepared = await this._pdf.prepare(report.toObject ? report.toObject() : report);
      return global.Helpers.makeSuccessServiceStatus('Report PDF prepared.', prepared);
    } catch (err: any) {
      this.log('prepareReportDownload', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus(err?.message === 'REPORT_DATA_MISSING'
        ? 'Generate this report before downloading it.' : 'Unable to generate report PDF.');
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
