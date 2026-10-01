import { http } from '@core/http/http';
import { API_BASE_URL } from '@core/http/env';
import { fromApi, toApi } from '@core/http/case';
import { oneOf, rowsOf, safeRead } from '@core/http/util';
import { GeneratedReport, ReportItem } from '@shared/models';

/**
 * Live report routes (verified):
 *   POST   /v1/reports          create   { project_id, name, definition?, format?, status? }
 *   GET    /v1/reports          list     (?project_id= &limit= &page=)
 *   GET    /v1/reports/:id      read one
 *   PUT    /v1/reports/:id      update   (name | definition | format | status | artifact_url)
 *   DELETE /v1/reports/:id      soft delete
 *
 * NOT built: /reports/:id/generate, /status, /export/:fmt, /send (all 404).
 * A completed report exposes its file via the `artifact_url` field.
 */

export async function listReports(projectId?: string): Promise<ReportItem[]> {
  const all: ReportItem[] = [];
  let page = 1, totalPages = 1;
  do {
    const res = await http.get('/reports', { params: { project_id: projectId, page, limit: 100 } });
    const data = fromApi(res.data) as { totalPages?: number };
    all.push(...rowsOf<ReportItem>(res.data));
    totalPages = data.totalPages || 1;
    page++;
  } while (page <= totalPages);
  return all.filter(r => !projectId || r.projectId === projectId)
    .sort((a, b) => Date.parse(b.generatedAt || b.createdAt || '') - Date.parse(a.generatedAt || a.createdAt || ''));

}

export interface CreateAiReportInput {
  projectId: string;
  name: string;
  format: 'pdf';
  content?: string;
  forceRegenerate: boolean;
  reportType: 'project' | 'sprint';
  sprintId?: string;
}

export interface CreateAiReportResult {
  record: ReportItem;
  generatedReport: GeneratedReport | null;
  cacheHit: boolean;
}

/**
 * Create or regenerate a report. The response interceptor has already unwrapped
 * `response.data.response.dataset`, so `res.data` is the canonical record here.
 */
export async function createAiReport(input: CreateAiReportInput): Promise<CreateAiReportResult> {
  const res = await http.post('/reports', toApi(input), { timeout: 180_000 });
  const record = fromApi(res.data) as ReportItem;
  const generatedReport = (record.reportData ?? record.definition?.generatedReport ?? null) as GeneratedReport | null;
  return { record, generatedReport, cacheHit: record.cacheHit === true };
}

/** Load a saved report only. This endpoint never invokes report generation. */
export async function getReport(reportId: string): Promise<ReportItem | null> {
  const res = await http.get(`/reports/${reportId}`);
  return oneOf<ReportItem>(res.data);
}

export async function getRepositorySyncStatus(projectId: string): Promise<Record<string, unknown> | null> {
  return safeRead(async () => fromApi((await http.get(`/projects/${projectId}/github/sync-status`)).data), null, 'reports.repositoryStatus');
}

/**
 * `trigger: 'central'` marks the header AI Sync button, which the backend limits with
 * CENTRAL_AI_SYNC_COOLDOWN_MINUTES; every other caller uses AI_SYNC_COOLDOWN_MINUTES.
 */
export async function syncProjectRepository(
  projectId: string,
  options: { trigger?: 'central' } = {}
): Promise<Record<string, unknown>> {
  const body = options.trigger ? { trigger: options.trigger } : {};
  const res = await http.post(`/projects/${projectId}/github/sync`, body, { timeout: 180_000 });
  return res.data;
}

/** Download the backend-rendered PDF for the report's saved report_data. */
export async function downloadReportPdf(reportId: string): Promise<Blob> {
  const res = await http.get(`/reports/${reportId}/download`, {
    responseType: 'blob',
    headers: { Accept: 'application/pdf' },
  });
  return res.data as Blob;
}

export async function updateReport(id: string, body: Partial<ReportItem>) {
  const res = await http.put(`/reports/${id}`, toApi(body));
  return res.data;
}

export async function deleteReport(id: string) {
  const res = await http.delete(`/reports/${id}`);
  return res.data;
}

/**
 * Fetch a completed report's artifact file as a Blob.
 *
 * - Absolute URLs (e.g. presigned S3 links) are fetched directly — sending an
 *   Authorization header to a third-party host can break CORS.
 * - Relative paths are resolved against `API_BASE_URL` and requested through
 *   the axios client so the Bearer token is attached.
 * - The axios response interceptor passes binary responses through untouched
 *   (a Blob has no `.response` envelope), so `res.data` is the raw file.
 *
 * Returns `null` when the report has no `artifact_url` — the caller falls back
 * to a client-generated PDF. Extension follows the report's format (pdf default).
 */
export async function fetchReportArtifact(
  report: ReportItem
): Promise<{ blob: Blob; ext: string } | null> {
  const url = report.artifactUrl;
  if (!url) return null;
  const ext = (report.format || 'pdf').toLowerCase();
  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Artifact download failed (${res.status})`);
    return { blob: await res.blob(), ext };
  }
  const res = await http.get(new URL(url, API_BASE_URL).href, { responseType: 'blob' });
  return { blob: res.data as Blob, ext };
}
