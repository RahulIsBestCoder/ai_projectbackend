'use client';

import React, { Fragment, useEffect, useState, useRef } from 'react';
import { ThemedLoader } from '@shared/components/ThemedLoader';
import { AlertTriangle, CheckSquare, Download, Eye, FileText, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Collapsible } from '@shared/components/Collapsible';
import { GeneratedReport, ReportItem, TaigaSprint } from '@shared/models';
import {
  listReports,
  createAiReport,
  getReport,
  getRepositorySyncStatus,
  syncProjectRepository,
  deleteReport,
  downloadReportPdf,
  listSprints,
  getRepositoryDepartments,
  RepoDepartmentsResponse,
} from '@core/services';
import { saveBlob, slugify } from '@core/services/pdf';

const REPORT_NAME = 'Latest Project Report';
const DEFAULT_INSTRUCTIONS = 'Assess current project delivery, implementation evidence, remaining work, deadline confidence, risks, and recovery actions.';

const savedReportData = (record: ReportItem | null | undefined) =>
  record?.reportData ?? record?.definition?.generatedReport ?? null;

const savedReportType = (record: ReportItem): 'project' | 'sprint' =>
  savedReportData(record)?.report?.type === 'sprint_review' || record.definition?.reportType === 'sprint' ? 'sprint' : 'project';

const savedSprintId = (record: ReportItem): string =>
  String(savedReportData(record)?.report?.sprint?.id || record.definition?.sprintId || '');

type ReportsViewProps = {
  projectId: string;
  /** Selected project name used as a fallback for legacy saved reports. */
  projectName?: string;
  /** Organization of the selected project; lets legacy reports load departments live. */
  organizationId?: string;
  onToast: (m: string) => void;
};
export const ReportsView: React.FC<ReportsViewProps> = props => <ReportsContent key={props.projectId} {...props} />;
const ReportsContent: React.FC<ReportsViewProps> = ({ projectId, projectName, organizationId, onToast }) => {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [loadError, setLoadError] = useState('');
  const [reports, setReports] = useState<ReportItem[] | null>(null);
  const [content, setContent] = useState(DEFAULT_INSTRUCTIONS);
  const [busy, setBusy] = useState(false);
  const [generatedReport, setGeneratedReport] = useState<GeneratedReport | null>(null);
  /** The record behind `generatedReport` — what the Download buttons export. */
  const [activeReport, setActiveReport] = useState<ReportItem | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [repositoryReady, setRepositoryReady] = useState<boolean | null>(null);
  const [syncingRepository, setSyncingRepository] = useState(false);
  const [reportType, setReportType] = useState<'project' | 'sprint'>('project');
  const [sprints, setSprints] = useState<TaigaSprint[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState('');

  const load = async () => {
    try {
      const rows = await listReports(projectId);
      if (mounted.current) { setReports(rows); setLoadError(''); }
      return rows;
    } catch (error: any) {
      if (mounted.current) { setLoadError(error?.msg || 'Could not load reports. Please retry.'); setReports([]); }
      return [];
    }
  };
  useEffect(() => { void load(); }, [projectId]);

  useEffect(() => {
    if (reports === null) return;
    let alive = true;
    const matching = reports.find((record) => savedReportType(record) === reportType
      && (reportType === 'project' || savedSprintId(record) === selectedSprintId));
    if (!matching) {
      setGeneratedReport(null);
      setActiveReport(null);
      return () => { alive = false; };
    }
    void (async () => {
      const record = savedReportData(matching) ? matching : await getReport(matching.id);
      if (!alive || !record) return;
      setGeneratedReport(savedReportData(record));
      setActiveReport(record);
    })().catch((error: any) => { if (alive) setLoadError(error?.msg || 'Could not open saved report.'); });
    return () => { alive = false; };
  }, [reports, reportType, selectedSprintId]);

  useEffect(() => {
    let alive = true;
    void listSprints(projectId).then((rows) => {
      if (!alive) return;
      setSprints(rows);
      setSelectedSprintId((current) => current || rows.find((sprint) => !sprint.isClosed)?.id || rows[0]?.id || '');
    });
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => {
    void getRepositorySyncStatus(projectId).then((status) => {
      if (!mounted.current) return;
      if (!status) return setRepositoryReady(null);
      const value = String(status.status || status.syncStatus || '').toLowerCase();
      setRepositoryReady(status.hasSuccessfulSnapshot === true || status.successful === true || value === 'success' || value === 'synced' || value === 'completed');
    });
  }, [projectId]);

  const submitReport = async (forceRegenerate: boolean) => {
    if (!projectId) return onToast('A project is required');
    if (content.length > 20_000) return onToast('Report instructions must be 20,000 characters or less');
    if (reportType === 'sprint' && !selectedSprintId) return onToast('Select a sprint to generate its report');
    setBusy(true);
    try {
      const selectedSprint = sprints.find((sprint) => sprint.id === selectedSprintId);
      const created = await createAiReport({
        projectId,
        name: reportType === 'sprint' ? `${selectedSprint?.name || 'Sprint'} Report` : REPORT_NAME,
        format: 'pdf', content: content.trim() || undefined,
        forceRegenerate,
        reportType,
        sprintId: reportType === 'sprint' ? selectedSprintId : undefined,
      });
      if (!mounted.current) return;
      setGeneratedReport(created.generatedReport);
      setActiveReport(created.record);
      onToast(created.cacheHit ? 'Loaded saved report' : reportType === 'sprint' ? 'Sprint report generated' : 'Latest project report generated');
      await load();
    } catch (err: any) {
      onToast(err?.msg || 'Could not create the report');
    } finally {
      setBusy(false);
    }
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    void submitReport(false);
  };

  const syncRepository = async () => {
    if (syncingRepository || busy) return;
    setSyncingRepository(true);
    try {
      await syncProjectRepository(projectId);
      if (!mounted.current) return;
      const status = await getRepositorySyncStatus(projectId);
      setRepositoryReady(status?.hasSuccessfulSnapshot === true || status?.successful === true || ['success', 'synced', 'completed'].includes(String(status?.status || status?.syncStatus || '').toLowerCase()));
      onToast('Repository synced');
      await submitReport(true);
    } catch (err: any) {
      onToast(err?.msg || 'Repository sync failed');
    } finally {
      setSyncingRepository(false);
    }
  };

  const openReport = async (reportId: string) => {
    setOpening(reportId);
    try {
      const record = await getReport(reportId);
      const saved = record?.reportData ?? record?.definition?.generatedReport ?? null;
      if (!mounted.current) return;
      if (!record || !saved) return onToast(record?.status === 'failed' ? 'Generation failed. Select this scope and retry.' : 'This report has no generated content yet');
      setGeneratedReport(saved);
      setActiveReport(record);
      const openedType = savedReportType(record);
      setReportType(openedType);
      if (openedType === 'sprint') setSelectedSprintId(savedSprintId(record));
      setContent(record?.reportContent || record?.content || content);
      onToast('Saved report loaded');
    } catch (err: any) {
      onToast(err?.msg || 'Could not load the report');
    } finally {
      setOpening(null);
    }
  };

  const remove = async (id: string) => {
    setDeleting(id);
    try {
      await deleteReport(id);
      onToast('Report deleted');
      await load();
    } catch (err: any) {
      onToast(err?.msg || 'Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  /**
   * Download a report as the styled "AI Project Assistant" PDF.
   *
   * The PDF is rendered in the browser (`lib/reportExport.ts`) so the file
   * matches the sample template and prints the project's real data, and it is
   * always saved as `.pdf` because those are the bytes we produce. Only non-PDF
   * reports (html/ppt) may use the backend `artifact_url`, and only when that
   * file actually downloads — the seeded URLs are not real files.
   */
  const download = async (r: ReportItem | null) => {
    if (!r) return onToast('Generate or open a report first');
    setDownloading(r.id);
    try {
      const blob = await downloadReportPdf(r.id);
      saveBlob(blob, `${slugify(r.name)}.pdf`);
      onToast('Report downloaded as PDF');
    } catch (err: any) {
      onToast(err?.msg || 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="p-5 bg-white border-2 border-slate-900 shadow-sm flex items-center text-indigo-700 text-xs font-black uppercase tracking-widest">
        <div className="flex items-center space-x-2">
          <FileText className="w-4 h-4" />
          <span>Report List</span>
        </div>
      </div>

        <form onSubmit={create} className="p-4 bg-white border-2 border-indigo-600 space-y-3">
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider">Generate report</h2>
            <p className="text-xs font-mono text-slate-500 mt-1">Choose the complete project or one specific sprint.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Report scope">
            <button type="button" role="radio" aria-checked={reportType === 'project'} disabled={busy || syncingRepository || !!opening} onClick={() => { setActiveReport(null); setGeneratedReport(null); setReportType('project'); }}
              className={`p-3 border text-left ${reportType === 'project' ? 'border-indigo-600 bg-indigo-50 text-indigo-900' : 'border-slate-300 bg-white text-slate-700'}`}>
              <span className="block text-xs font-black uppercase tracking-wider">Whole project</span>
              <span className="block mt-1 text-xs font-mono">All project tasks, sprints, repository activity, risks, and progress.</span>
            </button>
            <button type="button" role="radio" aria-checked={reportType === 'sprint'} disabled={busy || syncingRepository || !!opening} onClick={() => { setActiveReport(null); setGeneratedReport(null); setReportType('sprint'); }}
              className={`p-3 border text-left ${reportType === 'sprint' ? 'border-indigo-600 bg-indigo-50 text-indigo-900' : 'border-slate-300 bg-white text-slate-700'}`}>
              <span className="block text-xs font-black uppercase tracking-wider">Specific sprint</span>
              <span className="block mt-1 text-xs font-mono">Tasks, status counts, team work, and Git activity within the selected sprint.</span>
            </button>
          </div>
          {reportType === 'sprint' && (
            <label className="block">
              <span className="block text-xs font-black uppercase tracking-widest text-slate-600 mb-1">Select sprint</span>
              <select value={selectedSprintId} onChange={(event) => { setActiveReport(null); setGeneratedReport(null); setSelectedSprintId(event.target.value); }} disabled={busy || syncingRepository || !!opening || !sprints.length}
                className="w-full bg-white border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-600 disabled:bg-slate-100">
                {!sprints.length && <option value="">No sprints available</option>}
                {sprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name}{sprint.isClosed ? ' (Closed)' : ' (Active)'}</option>)}
              </select>
            </label>
          )}
          {repositoryReady === false && <div className="border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex items-center justify-between gap-3"><span>Repository source has not completed a whole-repository sync.</span><button type="button" onClick={() => void syncRepository()} disabled={syncingRepository || busy} className="font-bold text-indigo-700 disabled:opacity-50">{syncingRepository ? 'Syncing…' : 'Sync repository'}</button></div>}
          <label htmlFor="report-instructions" className="block text-xs font-semibold">Report instructions</label>
          <textarea
            id="report-instructions"
            disabled={busy || syncingRepository}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={20_000}
            rows={4}
            placeholder="Report instructions and content requirements"
            className="w-full bg-slate-50 border border-slate-300 px-2.5 py-2 text-xs font-mono text-slate-800 focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            {!activeReport ? <button type="submit" disabled={busy || syncingRepository || !!opening || (reportType === 'sprint' && !selectedSprintId)} className="flex items-center space-x-2 px-4 py-2 bg-slate-900 hover:bg-black text-white text-xs font-bold uppercase tracking-widest border border-black disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              <span>{busy ? 'Collecting project evidence and generating the latest report…' : 'Generate report'}</span>
            </button> : <button type="button" onClick={() => void submitReport(true)} disabled={busy || syncingRepository || !!opening || (reportType === 'sprint' && !selectedSprintId)} className="flex items-center space-x-2 px-4 py-2 bg-white hover:bg-indigo-50 text-indigo-700 text-xs font-bold uppercase tracking-widest border border-indigo-400 disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
              <span>{busy ? 'Collecting project evidence and generating the latest report…' : 'Refresh report'}</span>
            </button>}
            <button
              type="button"
              onClick={() => void download(activeReport)}
              disabled={!activeReport || downloading === activeReport?.id}
              className="flex items-center space-x-2 px-4 py-2 bg-white hover:bg-emerald-50 text-emerald-700 text-xs font-bold uppercase tracking-widest border border-emerald-400 disabled:opacity-50"
              title="Download the generated report as a PDF matching the sample template"
            >
              {activeReport && downloading === activeReport.id ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span>Download PDF</span>
            </button>
          </div>
        </form>

      {loadError && <div role="alert" className="border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{loadError} <button type="button" onClick={() => void load()} className="underline font-semibold">Retry loading</button></div>}
      {(busy || syncingRepository) && <p role="status" aria-live="polite" className="text-sm text-indigo-700">{syncingRepository ? 'Synchronizing repository evidence...' : 'Generating report. Any report shown below is the previous saved snapshot.'}</p>}
      {reports?.some(r => r.status === 'failed' && savedReportType(r) === reportType && (reportType === 'project' || savedSprintId(r) === selectedSprintId)) && <p role="alert" className="text-sm text-rose-700">The last generation failed. Generate or refresh to retry. Previous saved content may be shown below.</p>}
      {generatedReport && (
        <GeneratedReportDetail
          report={generatedReport}
          reportStatus={activeReport?.status}
          projectId={projectId}
          organizationId={organizationId}
          busy={!!activeReport && downloading === activeReport.id}
          onDownload={() => void download(activeReport)}
          onSync={() => void syncRepository()}
        />
      )}

      <Collapsible title="Whole-project report" subtitle={reports?.filter((record) => savedReportType(record) === 'project').length ? String(reports.filter((record) => savedReportType(record) === 'project').length) : undefined} bodyClassName="">
      {loadError ? <p className="p-4 text-sm text-rose-700">Reports could not be loaded.</p> : reports === null ? (
        <div className="p-10 bg-white border border-slate-300 flex items-center justify-center text-slate-500 text-xs font-mono uppercase tracking-widest">
          <ThemedLoader label="Loading reports" />
        </div>
      ) : reports.filter((record) => savedReportType(record) === 'project').length === 0 ? (
        <div className="p-10 bg-white border border-slate-300 text-center">
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">
            No whole-project report generated yet
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-300">
          {reports.filter((record) => savedReportType(record) === 'project').map((r) => (
            <div key={r.id} className="px-4 py-3 border-b border-slate-100 last:border-0">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-mono font-semibold text-slate-700">
                  {r.reportData?.report?.generatedAt || r.definition?.generatedReport?.report?.generatedAt || r.generatedAt || r.createdAt
                    ? new Date(r.reportData?.report?.generatedAt || r.definition?.generatedReport?.report?.generatedAt || r.generatedAt || r.createdAt || '').toLocaleString()
                    : 'Generation time unavailable'}
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void openReport(r.id)}
                    disabled={!!opening || busy || syncingRepository}
                    className="flex items-center space-x-1.5 px-2 py-1 bg-white hover:bg-slate-50 border border-slate-300 disabled:opacity-50"
                    title="Open saved report"
                  >
                    {opening === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                    <span className="text-xs font-bold uppercase">Open</span>
                  </button>
                  <button
                    onClick={() => remove(r.id)}
                    disabled={!!deleting || busy || syncingRepository || !!opening}
                    className="p-1 bg-white hover:bg-rose-50 border border-slate-300 disabled:opacity-50"
                    title="Delete report"
                  >
                    {deleting === r.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      </Collapsible>

      <Collapsible title="Sprint reports" subtitle={reports ? String(reports.filter((record) => savedReportType(record) === 'sprint').length) : undefined} bodyClassName="">
      {loadError ? <p className="p-4 text-sm text-rose-700">Reports could not be loaded.</p> : reports === null ? (
        <div className="p-10 bg-white border border-slate-300 flex items-center justify-center text-slate-500 text-xs font-mono uppercase tracking-widest">
          <ThemedLoader label="Loading sprint reports" />
        </div>
      ) : reports.filter((record) => savedReportType(record) === 'sprint').length === 0 ? (
        <div className="p-10 bg-white border border-slate-300 text-center">
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">No sprint reports generated yet</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-300">
          {reports.filter((record) => savedReportType(record) === 'sprint').map((r) => {
            const saved = savedReportData(r);
            return <div key={r.id} className="px-4 py-3 border-b border-slate-100 last:border-0">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-slate-800">{saved?.report?.sprint?.name || r.name}</div>
                  <div className="text-xs font-mono text-slate-500">
                    {saved?.report?.generatedAt || r.generatedAt || r.createdAt
                      ? new Date(saved?.report?.generatedAt || r.generatedAt || r.createdAt || '').toLocaleString()
                      : 'Generation time unavailable'}
                  </div>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <button type="button" onClick={() => void openReport(r.id)} disabled={!!opening || busy || syncingRepository}
                    className="flex items-center space-x-1.5 px-2 py-1 bg-white hover:bg-slate-50 border border-slate-300 disabled:opacity-50">
                    {opening === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                    <span className="text-xs font-bold uppercase">Open</span>
                  </button>
                  <button onClick={() => remove(r.id)} disabled={!!deleting || busy || syncingRepository || !!opening}
                    className="p-1 bg-white hover:bg-rose-50 border border-slate-300 disabled:opacity-50" title="Delete sprint report">
                    {deleting === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" /> : <Trash2 className="w-3.5 h-3.5 text-rose-600" />}
                  </button>
                </div>
              </div>
            </div>;
          })}
        </div>
      )}
      </Collapsible>
    </div>
  );
};

const humanizeKey = (key: string) =>
  key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return 'Not available';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  const text = String(value);
  const date = /^\d{4}-\d{2}-\d{2}T/.test(text) ? new Date(text) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : text;
};

const displayProbability = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return 'Not enough delivery data';
  const percent = value >= 0 && value <= 1 ? value * 100 : value;
  return `${Number(percent.toFixed(1))}%`;
};

/** Render API snapshot data as readable cards/lists without exposing raw JSON. */
const SnapshotData: React.FC<{ data: unknown; depth?: number }> = ({ data, depth = 0 }) => {
  if (data === null || data === undefined) return <p className="text-[11px] text-slate-400">No verified data available.</p>;
  if (Array.isArray(data)) {
    if (!data.length) return <p className="text-[11px] text-slate-400">No items reported.</p>;
    return <div className="space-y-2">{data.slice(0, 20).map((item, index) =>
      isRecord(item) ? <div key={index} className="bg-slate-50 border border-slate-200 p-2"><SnapshotData data={item} depth={depth + 1} /></div>
        : <div key={index} className="text-xs text-slate-700">{displayValue(item)}</div>)}
      {data.length > 20 && <p className="text-xs text-slate-500">+ {data.length - 20} more items</p>}
    </div>;
  }
  if (!isRecord(data)) return <span className="text-xs text-slate-700 break-words">{displayValue(data)}</span>;

  const entries = Object.entries(data).filter(([, value]) => value !== null && value !== undefined);
  if (!entries.length) return <p className="text-[11px] text-slate-400">No verified data available.</p>;
  const simple = entries.filter(([, value]) => !isRecord(value) && !Array.isArray(value));
  const nested = entries.filter(([, value]) => isRecord(value) || Array.isArray(value));
  return <div className="space-y-3">
    {simple.length > 0 && <div className={`grid gap-2 ${depth === 0 ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
      {simple.map(([key, value]) => {
        const percentage = typeof value === 'number' && /(progress|percent|rate|completion)/i.test(key) && value >= 0 && value <= 100;
        return <div key={key} className="min-w-0 rounded-sm bg-slate-50 border border-slate-200 p-2">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">{humanizeKey(key)}</div>
          <div className="text-xs font-semibold text-slate-800 break-words">{displayValue(value)}{percentage ? '%' : ''}</div>
          {percentage && <div className="h-1.5 bg-slate-200 mt-1.5 overflow-hidden"><div className="h-full bg-indigo-600" style={{ width: `${value}%` }} /></div>}
        </div>;
      })}
    </div>}
    {nested.map(([key, value]) => <div key={key}>
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">{humanizeKey(key)}</h4>
      <SnapshotData data={value} depth={depth + 1} />
    </div>)}
  </div>;
};

const CHART_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#64748b', '#06b6d4'];

const numericEntries = (value: unknown) => isRecord(value)
  ? Object.entries(value)
      .filter(([, amount]) => typeof amount === 'number' && Number.isFinite(amount))
      .map(([name, amount]) => ({ name: humanizeKey(name), value: amount as number }))
  : [];

const nestedRecord = (value: unknown, key: string): Record<string, unknown> | undefined =>
  isRecord(value) && isRecord(value[key]) ? value[key] as Record<string, unknown> : undefined;

const FEATURE_STATUS_STYLE = {
  implemented: { badge: 'bg-emerald-100 text-emerald-800 border-emerald-300', bar: 'bg-emerald-600' },
  partial: { badge: 'bg-amber-100 text-amber-900 border-amber-300', bar: 'bg-amber-500' },
  not_implemented: { badge: 'bg-rose-100 text-rose-800 border-rose-300', bar: 'bg-rose-600' },
  unknown: { badge: 'bg-purple-100 text-purple-800 border-purple-300', bar: 'bg-purple-600' },
} as const;

const ReportVisuals: React.FC<{ report: GeneratedReport }> = ({ report }) => {
  const charts = report.visualData || [];
  if (!charts.length) return <p className="text-xs text-slate-400">No chart data was returned for this report.</p>;
  return <div>
    <h3 className="font-bold text-sm mb-2">Report charts</h3>
    <div className="grid md:grid-cols-2 gap-3">
      {charts.map((chart) => {
        const rows = chart.labels.map((label, index) => Object.fromEntries([
          ['name', label],
          ...chart.datasets.map((dataset) => [dataset.label, dataset.data[index]]),
        ]));
        const pieData = chart.labels.map((label, index) => ({ name: label, value: chart.datasets[0]?.data[index] ?? 0 }));
        return <div key={chart.id} className="border border-slate-200 p-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">{chart.title === 'Plan vs actual progress' ? 'Completion by evidence source' : chart.title}</h4>
        {chart.datasets.some(d => d.data.some(v => v == null)) && <p className="text-xs text-slate-500 mb-2">Gaps mean evidence is unavailable, not zero.</p>}
        <div className="h-52"><ResponsiveContainer width="100%" height="100%">
          {chart.type === 'pie' ? <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={38} outerRadius={70} paddingAngle={2} label={({ name, value }) => `${name}: ${value}`}>
              {pieData.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
            </Pie><Tooltip /><Legend />
          </PieChart> : chart.type === 'line' ? <LineChart data={rows} margin={{ top: 8, right: 12, left: -20, bottom: 18 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend />
            {chart.datasets.map((dataset, index) => <Line key={dataset.label} type="linear" dataKey={dataset.label} stroke={CHART_COLORS[index % CHART_COLORS.length]} strokeWidth={2} />)}
          </LineChart> : <BarChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 18 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" />
            <YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend />
            {chart.datasets.map((dataset, index) => <Bar key={dataset.label} dataKey={dataset.label} fill={CHART_COLORS[index % CHART_COLORS.length]} radius={[3, 3, 0, 0]} />)}
          </BarChart>}
        </ResponsiveContainer></div>
      </div>})}
    </div>
  </div>;
};

const GeneratedReportDetail: React.FC<{
  report: GeneratedReport;
  reportStatus?: ReportItem['status'];
  /** Selected project, used to load departments for reports saved before that sync. */
  projectId: string;
  organizationId?: string;
  /** True while this report's PDF is being rendered for download. */
  busy?: boolean;
  onDownload: () => void;
  onSync: () => void;
}> = ({ report, reportStatus, projectId, organizationId, busy, onDownload, onSync }) => {
  const legacy = report as any;
  if (
    !legacy?.report || !legacy?.executiveSummary || !legacy?.healthAndTrend ||
    !legacy?.velocityAndSprint || !legacy?.risksAndPredictions || !legacy?.workBreakdown ||
    !legacy?.planAndActual || !legacy?.repositoryActivity || !legacy?.gitActivity || !legacy?.aiNarrative
  ) {
    const legacyInsights = Array.isArray(legacy?.insights) ? legacy.insights : [];
    const legacyRecommendations = Array.isArray(legacy?.recommendations) ? legacy.recommendations : [];
    return <section className="bg-white border-2 border-slate-900 p-5 space-y-5">
      <div className="flex items-center justify-between gap-3"><div><h2 className="font-black text-lg">Saved project report</h2><p className="text-xs text-amber-700 mt-1">Legacy report format</p></div><button type="button" onClick={onDownload} disabled={busy} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold uppercase disabled:opacity-50">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} PDF</button></div>
      <ReportSection title="Executive summary"><p className="text-sm text-slate-700 whitespace-pre-wrap">{legacy?.summary || 'No summary was saved for this report.'}</p></ReportSection>
      {legacy?.projectSnapshot && <ReportSection title="Project data"><SnapshotData data={legacy.projectSnapshot} /></ReportSection>}
      {legacyInsights.length > 0 && <ReportSection title="Insights"><div className="space-y-2">{legacyInsights.map((item: any, index: number) => <div key={`${item.title || 'insight'}-${index}`} className="border-l-2 border-indigo-500 pl-3 text-xs"><strong>{item.title || 'Insight'}</strong><p>{item.description || ''}</p>{Array.isArray(item.evidence) && item.evidence.length > 0 && <p className="text-xs text-slate-500 mt-1">Evidence: {item.evidence.join('; ')}</p>}</div>)}</div></ReportSection>}
      {legacyRecommendations.length > 0 && <ReportSection title="Recommendations">{legacyRecommendations.map((item: any, index: number) => <p key={`${item.action || 'recommendation'}-${index}`} className="text-xs mb-1"><CheckSquare className="inline w-3.5 h-3.5 mr-1 text-indigo-600" />{item.action || item.text || 'Recommendation'}</p>)}</ReportSection>}
      <p className="text-xs text-slate-500">Refresh this report to upgrade it to the latest project-report.v1 format.</p>
    </section>;
  }
  const meta = report.report;
  const summary = report.executiveSummary;
  const health = report.healthAndTrend;
  const velocity = report.velocityAndSprint;
  const risks = report.risksAndPredictions;
  const work = report.workBreakdown;
  const repos = report.repositoryActivity;
  const narrative = report.aiNarrative;
  const incompleteSync = repos.synced < repos.total;
  const deadline = risks.predictions.deadlineProbability;
  const kpis = [
    ['Complete', `${summary.overallProgress}%`], ['Remaining', `${summary.remainingProgress}%`],
    ['Tasks', `${summary.completedTasks} / ${summary.totalTasks}`],
    ['Deadline outlook score', displayProbability(deadline)],
  ];
  return <section className="bg-white border-2 border-slate-900 p-5 space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-slate-900 pb-4">
      <div><h2 className="font-black text-xl">{meta.title}</h2><p className="text-xs text-slate-600">{meta.project.name} · {meta.period.label}</p><p className="text-xs font-mono text-slate-500 mt-1">{new Date(meta.generatedAt).toLocaleString()} · {meta.repositoryCount} repositories</p></div>
      <div className="flex items-center gap-2"><span className={`px-2 py-1 text-xs font-bold uppercase border ${reportStatus === 'generated_with_fallback' || meta.generatedBy === 'heuristic' ? 'bg-amber-100 text-amber-900 border-amber-300' : 'bg-indigo-100 text-indigo-800 border-indigo-300'}`}>{reportStatus === 'generated_with_fallback' || meta.generatedBy === 'heuristic' ? 'Verified-data fallback' : 'AI generated'}</span><button type="button" onClick={onDownload} disabled={busy} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold uppercase disabled:opacity-50">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} PDF</button></div>
    </header>
    {meta.generatedBy === 'heuristic' && <div className="border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">AI was unavailable. This report uses verified project data.</div>}
    {(meta.evidenceGenerationError || incompleteSync) && <div className="border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex justify-between gap-3"><span><AlertTriangle className="inline w-4 h-4 mr-1" />Repository evidence collection is incomplete. Unknown evidence is not treated as missing implementation.</span><button type="button" onClick={onSync} className="font-bold text-indigo-700">Sync repository</button></div>}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{kpis.map(([label, value]) => <div key={label} className="border border-slate-200 p-3"><p className="text-[11px] uppercase text-slate-500">{label}</p><p className="text-lg font-black">{value}</p></div>)}</div>
    <ReportSection title="Executive summary"><p className="text-sm text-slate-700 whitespace-pre-wrap">{summary.summary}</p></ReportSection>
    <ReportVisuals report={report} />
    <div className="grid md:grid-cols-2 gap-3">
      {/* `factors` is dropped: it repeats progress/velocity/git counts already shown elsewhere. */}
      <ReportSection title="Health and trend"><SnapshotData data={{ ...health, factors: undefined }} /></ReportSection>
      <ReportSection title="Velocity and sprint"><SnapshotData data={velocity} /></ReportSection>
      <ReportSection title="Completion evidence">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Complete" value={`${report.planAndActual.completePercent}%`} />
          <Metric label="Remaining" value={`${report.planAndActual.remainingPercent}%`} />
        </div>
        {report.planAndActual.calculationBasis && <p className="mt-3 text-xs text-slate-600">{report.planAndActual.calculationBasis}</p>}
      </ReportSection>
      <ReportSection title="Taiga work breakdown"><SnapshotData data={{ totalTasks: work.totalTasks, completed: work.completed, inProgress: work.inProgress, blocked: work.blocked, notStarted: work.notStarted, departments: work.byDepartment }} /></ReportSection>
    </div>
    <ReportSection title="Feature assessment">
      <div className="space-y-2">{work.byFeature.map((feature) => {
        const style = FEATURE_STATUS_STYLE[feature.status];
        return <div key={feature.featureId} className="border border-slate-200 p-3">
          <div className="flex justify-between gap-2">
            <strong className="text-xs">{feature.featureName}</strong>
            <span className={`border px-2 py-0.5 text-xs font-bold uppercase ${style.badge}`}>
              {feature.status === 'unknown' ? 'Insufficient evidence' : feature.status.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="h-1.5 bg-slate-200 my-2">
            <div className={`h-full ${style.bar}`} style={{ width: `${feature.progress}%` }} />
          </div>
          <p className="text-xs text-slate-500">{feature.completedTasks}/{feature.plannedTasks} tasks · {feature.progress}%</p>
          {feature.evidence.length > 0 && <ul className="mt-2 text-xs font-mono text-slate-600 list-disc pl-4">{feature.evidence.map((path) => <li key={path}>{path}</li>)}</ul>}
        </div>;
      })}</div>
    </ReportSection>
    {meta.type === 'sprint_review' ? <ReportSection title="Sprint team activity">
      <p className="text-xs text-slate-600 mb-3">Git activity is limited to the sprint dates. Task completion reflects the latest synchronized status of tasks assigned to this sprint.</p>
      <SnapshotData data={report.employeeWorking} />
    </ReportSection> : <DepartmentWorkforce report={report} projectId={projectId} organizationId={organizationId} /> }
    <ReportSection title="Risks and predictions">
      <p className="text-xs text-slate-600 mb-3">Outlook scores are heuristic indicators based on progress and available evidence, not calibrated probabilities of delivery.</p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
        <Metric label="Overall risk" value={risks.overallRisk || 'Unknown'} />
        <Metric label="Deadline risk" value={risks.deadlineRisk || 'Unknown'} />
        <Metric label="Deadline outlook score" value={displayProbability(risks.predictions.deadlineProbability)} />
        <Metric label="Delay outlook score" value={displayProbability(risks.predictions.delayProbability)} />
        <Metric label="Expected completion" value={risks.predictions.expectedCompletionDate ? new Date(risks.predictions.expectedCompletionDate).toLocaleDateString() : 'Not available'} />
      </div>
      <div className="space-y-2">{risks.risks.length > 0 ? risks.risks.map((risk, index) => <div key={`${risk.title}-${index}`} className="border-l-2 border-rose-500 pl-3 text-xs"><strong>{risk.title}</strong> <span className="uppercase text-slate-500">{risk.severity}</span><p>{risk.impact}</p><p className="text-slate-600">{risk.recommendation}</p></div>) : <p className="text-xs text-emerald-700">No individual risks were reported.</p>}</div>
    </ReportSection>
    <ReportSection title="AI findings and recommendations"><p className="text-sm mb-3">{narrative.summary}</p><div><h4 className="text-xs font-bold mb-1">Needs attention</h4>{narrative.whatNeedsAttention.map((item) => <p key={item} className="text-xs mb-1">• {item}</p>)}</div><div className="mt-3">{narrative.recommendations.map((item, index) => <p key={`${item.action}-${index}`} className="text-xs mb-1"><CheckSquare className="inline w-3.5 h-3.5 mr-1 text-indigo-600" />{item.action} <span className="uppercase text-slate-500">({item.priority})</span></p>)}</div></ReportSection>
    <ReportSection title="Evidence limitations and sources"><p className="text-xs text-slate-600">Repositories synced: {repos.synced} / {repos.total}</p><p className="text-xs text-slate-600 mt-1">{meta.sources.join(', ') || 'No sources reported.'}</p>{(meta.generationError || meta.evidenceGenerationError) && <details className="text-xs mt-2"><summary className="cursor-pointer">Technical details</summary><p className="mt-2 p-2 bg-slate-50 border">{meta.generationError || meta.evidenceGenerationError}</p></details>}</ReportSection>
  </section>;
};

/** Normalized shape shared by the saved snapshot and the live /departments response. */
type WorkloadEmployee = { id: string; name: string; commits: number; additions: number; deletions: number; active: boolean; created: number; closed: number; reportingRole: string | null };
type WorkloadDepartment = {
  id: string; name: string; color: string; description: string; memberCount: number; activeCount: number;
  commits: number; additions: number; deletions: number;
  repositories: Array<{ id: string; name: string | null; linked: boolean; project_name: string | null }>;
  tasks: { created: number; closed: number } | null;
  efficiency: { method: string; reported: number; closed: number; percent: number | null } | null;
  employees: WorkloadEmployee[];
};

/**
 * Departments (repository types + QA/Testing), captured with the report. Reports saved before
 * this sync have no snapshot, so they load the same data live from GET /departments.
 */
const DepartmentWorkforce: React.FC<{ report: GeneratedReport; projectId: string; organizationId?: string }> =
  ({ report, projectId, organizationId }) => {
    const saved = report.departmentWorkforce;
    const [live, setLive] = useState<RepoDepartmentsResponse | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
      if (saved || !projectId || !organizationId) return;
      let alive = true;
      getRepositoryDepartments(organizationId, projectId)
        .then((data) => { if (alive) setLive(data); })
        .catch((err: any) => { if (alive) setError(err?.msg || err?.message || 'Could not load departments for this project.'); });
      return () => { alive = false; };
    }, [saved, projectId, organizationId]);
    // Derived, so nothing is set synchronously inside the effect.
    const loading = !saved && !live && !error && Boolean(projectId && organizationId);

    const departments: WorkloadDepartment[] = saved
      ? saved.departments.map((department) => ({
        id: department.id, name: department.name, color: department.color || '#4f46e5', description: department.description,
        memberCount: department.member_count ?? 0, activeCount: department.active_count ?? 0,
        commits: department.commit_count ?? 0, additions: department.additions ?? 0, deletions: department.deletions ?? 0,
        repositories: department.repositories, tasks: department.tasks || null, efficiency: department.efficiency || null,
        employees: department.employees.map((employee) => ({
          id: employee.id, name: employee.name, commits: employee.commits ?? 0,
          additions: employee.additions ?? 0, deletions: employee.deletions ?? 0, active: employee.active,
          created: employee.tasks_created || employee.issues?.reported || 0,
          closed: employee.tasks_closed || employee.issues?.closed || 0, reportingRole: employee.reporting_role,
        })),
      }))
      : (live?.rows || []).map((department) => ({
        id: department.id, name: department.name, color: department.color || '#4f46e5', description: department.description,
        memberCount: department.member_count ?? 0, activeCount: department.active_count ?? 0,
        commits: department.commit_count ?? 0, additions: department.additions ?? 0, deletions: department.deletions ?? 0,
        repositories: department.repositories, tasks: department.tasks || null, efficiency: department.efficiency || null,
        employees: department.employees.map((employee) => ({
          id: employee.id, name: employee.name, commits: employee.commits ?? 0,
          additions: employee.additions ?? 0, deletions: employee.deletions ?? 0, active: employee.active,
          created: employee.tasks?.created ?? employee.issues?.reported ?? 0,
          closed: employee.tasks?.closed ?? employee.issues?.closed ?? 0, reportingRole: employee.reporting_role ?? null,
        })),
      }));
    const reportedPeople = saved ? saved.total_employees ?? 0 : live?.total_employees ?? 0;
    const people = reportedPeople || departments.reduce((total, department) => total + (department.memberCount || department.employees.length), 0);
    const unlinked = saved ? saved.unlinked_repository_count ?? 0 : live?.unlinked_repository_count ?? 0;
    const windowDays = saved ? saved.active_window_days : live?.active_window_days || null;

    return <ReportSection title="Departments">
      <p className="mb-4 text-[11px] text-slate-500">Grouped by repository type{windowDays ? ` · active = committed in the last ${windowDays} days` : ''} · {people} people{unlinked > 0 ? ` · ${unlinked} unlinked repositories` : ''}.</p>
      {loading ? <div className="p-6 flex items-center justify-center"><ThemedLoader label="Loading departments" /></div>
        : error ? <p className="text-xs text-rose-700">{error}</p>
        : departments.length === 0 ? <p className="text-xs text-slate-400">No department data was reported.</p>
        : <div className="overflow-x-auto border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr>
              {['Department', 'Member', 'Contribution'].map((label) => <th key={label} className="px-3 py-2 font-semibold">{label}</th>)}
            </tr></thead>
            <tbody>
              {departments.map((department) => {
                const isQa = department.id === 'testing';
                const efficiency = department.efficiency;
                const members = department.memberCount || department.employees.length;
                const actives = department.activeCount || department.employees.filter((employee) => employee.active).length;
                const contribution = isQa
                  ? `${department.tasks?.created ?? 0} tasks created · ${department.tasks?.closed ?? 0} closed${efficiency && efficiency.percent != null ? ` · QA closure rate ${efficiency.percent}%` : ''}`
                  : `${department.commits} commits · +${department.additions} / -${department.deletions} lines`;
                return <Fragment key={department.id}>
                  <tr className="border-t border-slate-200 text-slate-800" style={{ background: `${department.color}1a` }}>
                    <td className="px-3 py-2 font-bold" style={{ borderLeft: `4px solid ${department.color}`, color: department.color }}>{department.name}</td>
                    <td className="px-3 py-2">{members} {members === 1 ? 'member' : 'members'} · {actives} active</td>
                    <td className="px-3 py-2 tabular-nums">{contribution}</td>
                  </tr>
                  {department.employees.map((employee) => <tr key={employee.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 pl-6 text-slate-500" style={{ borderLeft: `4px solid ${department.color}40` }}>{department.name}</td>
                    <td className="px-3 py-2 text-slate-800">
                      {employee.name}
                      {isQa && employee.reportingRole === 'manager' && <span className="text-xs uppercase text-slate-500"> · Manager</span>}
                      {isQa && employee.reportingRole === 'qa' && <span className="text-xs uppercase text-slate-500"> · QA</span>}
                      {!isQa && !employee.active && <span className="text-slate-400"> · inactive</span>}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">
                      {isQa
                        ? `${employee.created} created · ${employee.closed} closed`
                        : `${employee.commits} commits · +${employee.additions} / -${employee.deletions} lines`}
                    </td>
                  </tr>)}
                </Fragment>;
              })}
            </tbody>
          </table>
        </div>}
    </ReportSection>;
  };
const ReportSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => <div className="border border-slate-200 p-4"><h3 className="font-bold text-sm mb-2">{title}</h3>{children}</div>;
const Metric: React.FC<{ label: string; value: string | number }> = ({ label, value }) => <div className="bg-slate-50 border border-slate-200 p-2"><p className="text-[11px] uppercase text-slate-500">{label}</p><p className="text-sm font-bold">{value}</p></div>;
