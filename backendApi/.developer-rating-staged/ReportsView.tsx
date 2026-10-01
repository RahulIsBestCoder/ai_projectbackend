'use client';

import React, { useEffect, useState } from 'react';
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

export const ReportsView: React.FC<{
  projectId: string;
  /** Selected project name used as a fallback for legacy saved reports. */
  projectName?: string;
  onToast: (m: string) => void;
}> = ({ projectId, projectName, onToast }) => {
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
    const rows = await listReports(projectId);
    setReports(rows);
    return rows;
  };
  useEffect(() => {
    let alive = true;
    void load().then(() => { if (!alive) return; });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

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
    })();
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
      setRepositoryReady(true);
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
      if (!record || !saved) return onToast('This report has no generated content yet');
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
            <p className="text-[10px] font-mono text-slate-500 mt-1">Choose the complete project or one specific sprint.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Report scope">
            <button type="button" role="radio" aria-checked={reportType === 'project'} onClick={() => setReportType('project')}
              className={`p-3 border text-left ${reportType === 'project' ? 'border-indigo-600 bg-indigo-50 text-indigo-900' : 'border-slate-300 bg-white text-slate-700'}`}>
              <span className="block text-xs font-black uppercase tracking-wider">Whole project</span>
              <span className="block mt-1 text-[10px] font-mono">All project tasks, sprints, repository activity, risks, and progress.</span>
            </button>
            <button type="button" role="radio" aria-checked={reportType === 'sprint'} onClick={() => setReportType('sprint')}
              className={`p-3 border text-left ${reportType === 'sprint' ? 'border-indigo-600 bg-indigo-50 text-indigo-900' : 'border-slate-300 bg-white text-slate-700'}`}>
              <span className="block text-xs font-black uppercase tracking-wider">Specific sprint</span>
              <span className="block mt-1 text-[10px] font-mono">Tasks, status counts, team work, and Git activity within the selected sprint.</span>
            </button>
          </div>
          {reportType === 'sprint' && (
            <label className="block">
              <span className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-1">Select sprint</span>
              <select value={selectedSprintId} onChange={(event) => setSelectedSprintId(event.target.value)} disabled={busy || !sprints.length}
                className="w-full bg-white border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-600 disabled:bg-slate-100">
                {!sprints.length && <option value="">No sprints available</option>}
                {sprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name}{sprint.isClosed ? ' (Closed)' : ' (Active)'}</option>)}
              </select>
            </label>
          )}
          {repositoryReady === false && <div className="border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex items-center justify-between gap-3"><span>Repository source has not completed a whole-repository sync.</span><button type="button" onClick={() => void syncRepository()} disabled={syncingRepository || busy} className="font-bold text-indigo-700 disabled:opacity-50">{syncingRepository ? 'Syncing…' : 'Sync repository'}</button></div>}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={20_000}
            rows={4}
            placeholder="Report instructions and content requirements"
            className="w-full bg-slate-50 border border-slate-300 px-2.5 py-2 text-xs font-mono text-slate-800 focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            {!activeReport ? <button type="submit" disabled={busy} className="flex items-center space-x-2 px-4 py-2 bg-slate-900 hover:bg-black text-white text-xs font-bold uppercase tracking-widest border border-black disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              <span>{busy ? 'Collecting project evidence and generating the latest report…' : 'Generate report'}</span>
            </button> : <button type="button" onClick={() => void submitReport(true)} disabled={busy} className="flex items-center space-x-2 px-4 py-2 bg-white hover:bg-indigo-50 text-indigo-700 text-xs font-bold uppercase tracking-widest border border-indigo-400 disabled:opacity-50">
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

      {generatedReport && (
        <GeneratedReportDetail
          report={generatedReport}
          reportStatus={activeReport?.status}
          busy={!!activeReport && downloading === activeReport.id}
          onDownload={() => void download(activeReport)}
          onSync={() => void syncRepository()}
        />
      )}

      <Collapsible title="Whole-project report" subtitle={reports?.filter((record) => savedReportType(record) === 'project').length ? '1' : undefined} bodyClassName="">
      {reports === null ? (
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
          {reports.filter((record) => savedReportType(record) === 'project').slice(0, 1).map((r) => (
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
                    disabled={opening === r.id}
                    className="flex items-center space-x-1.5 px-2 py-1 bg-white hover:bg-slate-50 border border-slate-300 disabled:opacity-50"
                    title="Open saved report"
                  >
                    {opening === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                    <span className="text-[10px] font-bold uppercase">Open</span>
                  </button>
                  <button
                    onClick={() => remove(r.id)}
                    disabled={deleting === r.id}
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
      {reports === null ? (
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
                  <div className="text-[10px] font-mono text-slate-500">
                    {saved?.report?.generatedAt || r.generatedAt || r.createdAt
                      ? new Date(saved?.report?.generatedAt || r.generatedAt || r.createdAt || '').toLocaleString()
                      : 'Generation time unavailable'}
                  </div>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <button type="button" onClick={() => void openReport(r.id)} disabled={opening === r.id}
                    className="flex items-center space-x-1.5 px-2 py-1 bg-white hover:bg-slate-50 border border-slate-300 disabled:opacity-50">
                    {opening === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                    <span className="text-[10px] font-bold uppercase">Open</span>
                  </button>
                  <button onClick={() => remove(r.id)} disabled={deleting === r.id}
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
      {data.length > 20 && <p className="text-[10px] text-slate-500">+ {data.length - 20} more items</p>}
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
          <div className="text-[9px] uppercase tracking-wider text-slate-500">{humanizeKey(key)}</div>
          <div className="text-xs font-semibold text-slate-800 break-words">{displayValue(value)}{percentage ? '%' : ''}</div>
          {percentage && <div className="h-1.5 bg-slate-200 mt-1.5 overflow-hidden"><div className="h-full bg-indigo-600" style={{ width: `${value}%` }} /></div>}
        </div>;
      })}
    </div>}
    {nested.map(([key, value]) => <div key={key}>
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-700 mb-1">{humanizeKey(key)}</h4>
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
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-700 mb-2">{chart.title}</h4>
        <div className="h-52"><ResponsiveContainer width="100%" height="100%">
          {chart.type === 'pie' ? <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={38} outerRadius={70} paddingAngle={2} label={({ name, value }) => `${name}: ${value}`}>
              {pieData.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
            </Pie><Tooltip /><Legend />
          </PieChart> : chart.type === 'line' ? <LineChart data={rows} margin={{ top: 8, right: 12, left: -20, bottom: 18 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} /><Tooltip /><Legend />
            {chart.datasets.map((dataset, index) => <Line key={dataset.label} type="monotone" dataKey={dataset.label} stroke={CHART_COLORS[index % CHART_COLORS.length]} strokeWidth={2} connectNulls />)}
          </LineChart> : <BarChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 18 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-15} textAnchor="end" />
            <YAxis tick={{ fontSize: 9 }} /><Tooltip /><Legend />
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
  /** True while this report's PDF is being rendered for download. */
  busy?: boolean;
  onDownload: () => void;
  onSync: () => void;
}> = ({ report, reportStatus, busy, onDownload, onSync }) => {
  const legacy = report as any;
  if (
    !legacy?.report || !legacy?.executiveSummary || !legacy?.healthAndTrend ||
    !legacy?.velocityAndSprint || !legacy?.risksAndPredictions || !legacy?.workBreakdown ||
    !legacy?.planAndActual || !legacy?.repositoryActivity || !legacy?.gitActivity || !legacy?.aiNarrative
  ) {
    const legacyInsights = Array.isArray(legacy?.insights) ? legacy.insights : [];
    const legacyRecommendations = Array.isArray(legacy?.recommendations) ? legacy.recommendations : [];
    return <section className="bg-white border-2 border-slate-900 p-5 space-y-5">
      <div className="flex items-center justify-between gap-3"><div><h2 className="font-black text-lg">Saved project report</h2><p className="text-[10px] text-amber-700 mt-1">Legacy report format</p></div><button type="button" onClick={onDownload} disabled={busy} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-[10px] font-bold uppercase disabled:opacity-50">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} PDF</button></div>
      <ReportSection title="Executive summary"><p className="text-sm text-slate-700 whitespace-pre-wrap">{legacy?.summary || 'No summary was saved for this report.'}</p></ReportSection>
      {legacy?.projectSnapshot && <ReportSection title="Project data"><SnapshotData data={legacy.projectSnapshot} /></ReportSection>}
      {legacyInsights.length > 0 && <ReportSection title="Insights"><div className="space-y-2">{legacyInsights.map((item: any, index: number) => <div key={`${item.title || 'insight'}-${index}`} className="border-l-2 border-indigo-500 pl-3 text-xs"><strong>{item.title || 'Insight'}</strong><p>{item.description || ''}</p>{Array.isArray(item.evidence) && item.evidence.length > 0 && <p className="text-[10px] text-slate-500 mt-1">Evidence: {item.evidence.join('; ')}</p>}</div>)}</div></ReportSection>}
      {legacyRecommendations.length > 0 && <ReportSection title="Recommendations">{legacyRecommendations.map((item: any, index: number) => <p key={`${item.action || 'recommendation'}-${index}`} className="text-xs mb-1"><CheckSquare className="inline w-3.5 h-3.5 mr-1 text-indigo-600" />{item.action || item.text || 'Recommendation'}</p>)}</ReportSection>}
      <p className="text-[10px] text-slate-500">Refresh this report to upgrade it to the latest project-report.v1 format.</p>
    </section>;
  }
  const meta = report.report;
  const summary = report.executiveSummary;
  const health = report.healthAndTrend;
  const velocity = report.velocityAndSprint;
  const risks = report.risksAndPredictions;
  const work = report.workBreakdown;
  const repos = report.repositoryActivity;
  const git = report.gitActivity;
  const narrative = report.aiNarrative;
  const incompleteSync = repos.synced < repos.total;
  const deadline = risks.predictions.deadlineProbability;
  const kpis = [
    ['Complete', `${summary.overallProgress}%`], ['Remaining', `${summary.remainingProgress}%`],
    ['Tasks', `${summary.completedTasks} / ${summary.totalTasks}`],
    ['Deadline confidence', displayProbability(deadline)],
  ];
  return <section className="bg-white border-2 border-slate-900 p-5 space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-slate-900 pb-4">
      <div><h2 className="font-black text-xl">{meta.title}</h2><p className="text-xs text-slate-600">{meta.project.name} · {meta.period.label}</p><p className="text-[10px] font-mono text-slate-500 mt-1">{new Date(meta.generatedAt).toLocaleString()} · {meta.repositoryCount} repositories</p></div>
      <div className="flex items-center gap-2"><span className={`px-2 py-1 text-[10px] font-bold uppercase border ${reportStatus === 'generated_with_fallback' || meta.generatedBy === 'heuristic' ? 'bg-amber-100 text-amber-900 border-amber-300' : 'bg-indigo-100 text-indigo-800 border-indigo-300'}`}>{reportStatus === 'generated_with_fallback' || meta.generatedBy === 'heuristic' ? 'Verified-data fallback' : 'AI generated'}</span><button type="button" onClick={onDownload} disabled={busy} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-[10px] font-bold uppercase disabled:opacity-50">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} PDF</button></div>
    </header>
    {meta.generatedBy === 'heuristic' && <div className="border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">AI was unavailable. This report uses verified project data.</div>}
    {(meta.evidenceGenerationError || incompleteSync) && <div className="border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex justify-between gap-3"><span><AlertTriangle className="inline w-4 h-4 mr-1" />Repository evidence collection is incomplete. Unknown evidence is not treated as missing implementation.</span><button type="button" onClick={onSync} className="font-bold text-indigo-700">Sync repository</button></div>}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{kpis.map(([label, value]) => <div key={label} className="border border-slate-200 p-3"><p className="text-[9px] uppercase text-slate-500">{label}</p><p className="text-lg font-black">{value}</p></div>)}</div>
    <ReportSection title="Executive summary"><p className="text-sm text-slate-700 whitespace-pre-wrap">{summary.summary}</p></ReportSection>
    <TaigaSprintSummary report={report} />
    <ReportVisuals report={report} />
    <div className="grid md:grid-cols-2 gap-3">
      {/* `factors` is dropped: it repeats progress/velocity/git counts already shown elsewhere. */}
      <ReportSection title="Health and trend"><SnapshotData data={{ ...health, factors: undefined }} /></ReportSection>
      <ReportSection title="Velocity and sprint"><SnapshotData data={velocity} /></ReportSection>
      <ReportSection title="Plan versus actual">
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
            <span className={`border px-2 py-0.5 text-[10px] font-bold uppercase ${style.badge}`}>
              {feature.status === 'unknown' ? 'Insufficient evidence' : feature.status.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="h-1.5 bg-slate-200 my-2">
            <div className={`h-full ${style.bar}`} style={{ width: `${feature.progress}%` }} />
          </div>
          <p className="text-[10px] text-slate-500">{feature.completedTasks}/{feature.plannedTasks} tasks · {feature.progress}%</p>
          {feature.evidence.length > 0 && <ul className="mt-2 text-[10px] font-mono text-slate-600 list-disc pl-4">{feature.evidence.map((path) => <li key={path}>{path}</li>)}</ul>}
        </div>;
      })}</div>
    </ReportSection>
    <EmployeeWorking report={report} />
    <ReportSection title="Git activity"><div className="grid grid-cols-2 md:grid-cols-5 gap-2"><Metric label="Commits" value={git.commits} /><Metric label="Commits / week" value={git.commitRatePerWeek} /><Metric label="Pull requests" value={git.pullRequests} /><Metric label="Merged PRs" value={git.mergedPullRequests} /><Metric label="Merge rate" value={`${git.mergeRatePercent}%`} /></div></ReportSection>
    <ReportSection title="Risks and predictions">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
        <Metric label="Overall risk" value={risks.overallRisk || 'Unknown'} />
        <Metric label="Deadline risk" value={risks.deadlineRisk || 'Unknown'} />
        <Metric label="Deadline probability" value={displayProbability(risks.predictions.deadlineProbability)} />
        <Metric label="Delay probability" value={displayProbability(risks.predictions.delayProbability)} />
        <Metric label="Expected completion" value={risks.predictions.expectedCompletionDate ? new Date(risks.predictions.expectedCompletionDate).toLocaleDateString() : 'Not available'} />
      </div>
      <div className="space-y-2">{risks.risks.length > 0 ? risks.risks.map((risk, index) => <div key={`${risk.title}-${index}`} className="border-l-2 border-rose-500 pl-3 text-xs"><strong>{risk.title}</strong> <span className="uppercase text-slate-500">{risk.severity}</span><p>{risk.impact}</p><p className="text-slate-600">{risk.recommendation}</p></div>) : <p className="text-xs text-emerald-700">No individual risks were reported.</p>}</div>
    </ReportSection>
    <ReportSection title="AI findings and recommendations"><p className="text-sm mb-3">{narrative.summary}</p><div><h4 className="text-xs font-bold mb-1">Needs attention</h4>{narrative.whatNeedsAttention.map((item) => <p key={item} className="text-xs mb-1">• {item}</p>)}</div><div className="mt-3">{narrative.recommendations.map((item, index) => <p key={`${item.action}-${index}`} className="text-xs mb-1"><CheckSquare className="inline w-3.5 h-3.5 mr-1 text-indigo-600" />{item.action} <span className="uppercase text-slate-500">({item.priority})</span></p>)}</div></ReportSection>
    <ReportSection title="Evidence limitations and sources"><p className="text-xs text-slate-600">Repositories synced: {repos.synced} / {repos.total}</p><p className="text-xs text-slate-600 mt-1">{meta.sources.join(', ') || 'No sources reported.'}</p>{(meta.generationError || meta.evidenceGenerationError) && <details className="text-xs mt-2"><summary className="cursor-pointer">Technical details</summary><p className="mt-2 p-2 bg-slate-50 border">{meta.generationError || meta.evidenceGenerationError}</p></details>}</ReportSection>
  </section>;
};

const taigaStatusTone = (name: string): string => {
  const status = name.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (['closed', 'done', 'completed'].includes(status)) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (['in progress', 'active', 'doing'].includes(status)) return 'bg-blue-100 text-blue-800 border-blue-200';
  if (['needs info', 'need info', 'pending info'].includes(status)) return 'bg-amber-100 text-amber-900 border-amber-200';
  if (['ready for test', 'ready for testing'].includes(status)) return 'bg-violet-100 text-violet-800 border-violet-200';
  if (['testing', 'qa'].includes(status)) return 'bg-cyan-100 text-cyan-800 border-cyan-200';
  if (['blocked', 'on hold'].includes(status)) return 'bg-rose-100 text-rose-800 border-rose-200';
  if (['new', 'open', 'todo', 'to do', 'backlog'].includes(status)) return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-indigo-50 text-indigo-800 border-indigo-200';
};

const TaigaSprintSummary: React.FC<{ report: GeneratedReport }> = ({ report }) => {
  const summary = report.taigaSprintSummary;
  if (!summary) return null;
  return <ReportSection title="Taiga task status by sprint">
    <div className="flex items-center justify-between gap-2 mb-2 text-xs text-slate-500">
      <span>{summary.rows.length} sprint groups · {summary.totalTasks} tasks</span>
      <span>At report generation</span>
    </div>
    {summary.rows.length ? <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-xs text-left">
        <thead className="bg-slate-50 text-slate-500"><tr>
          {['Sprint', 'Task statuses', 'Total', 'Closed', 'Blocked*'].map(label => <th key={label} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">{label}</th>)}
        </tr></thead>
        <tbody>{summary.rows.map((sprint, index) => <tr key={sprint.milestoneId || `unassigned-${index}`} className="border-t border-slate-100">
          <th scope="row" className="px-3 py-2 font-semibold text-slate-800 min-w-28">{sprint.sprintName}</th>
          <td className="px-3 py-2"><div className="flex flex-wrap gap-1 min-w-48">
            {sprint.statuses.map(status => <span key={status.name} className={`inline-flex items-center gap-2 rounded border px-2 py-1 font-medium ${taigaStatusTone(status.name)}`}>
              {status.name}<b className="tabular-nums">{status.count}</b>
            </span>)}
            {!sprint.total && <span className="text-slate-400">No tasks</span>}
          </div></td>
          <td className="px-3 py-2 tabular-nums font-semibold">{sprint.total}</td>
          <td className="px-3 py-2 tabular-nums text-emerald-700">{sprint.closed}</td>
          <td className="px-3 py-2 tabular-nums text-amber-700">{sprint.blocked}</td>
        </tr>)}</tbody>
      </table>
    </div> : <p className="text-xs text-slate-500">No synchronized Taiga tasks or sprints available.</p>}
    <p className="mt-2 text-[11px] text-slate-500">{summary.note}</p>
  </ReportSection>;
};

const EmployeeWorking: React.FC<{ report: GeneratedReport }> = ({ report }) => {
  const working = report.employeeWorking;
  if (!working) return null;
  type Developer = typeof working.departments[number]['employees'][number];
  const ratingOf = (employee: Developer) => {
    if (employee.activityScore != null && employee.activityRating) return { score: employee.activityScore, label: employee.activityRating };
    const lines = employee.gitAdditions + employee.gitDeletions;
    const score = Math.round(Math.min(100,
      Math.min(50, employee.gitCommits / 2)
      + Math.min(20, Math.log10(lines + 1) * 6)
      + (employee.taigaTasksAssigned ? 25 * employee.taigaTasksCompleted / employee.taigaTasksAssigned : 0)
      + (employee.gitCommits > 0 && employee.taigaTasksAssigned > 0 ? 5 : employee.gitCommits > 0 || employee.taigaTasksAssigned > 0 ? 3 : 0),
    ));
    return { score, label: score >= 85 ? 'Exceptional' : score >= 70 ? 'Strong' : score >= 50 ? 'Good' : score >= 30 ? 'Developing' : 'Limited evidence' };
  };
  const tone = (score: number) => score >= 70 ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : score >= 50 ? 'bg-blue-100 text-blue-800 border-blue-200'
      : score >= 30 ? 'bg-amber-100 text-amber-900 border-amber-200' : 'bg-slate-100 text-slate-700 border-slate-200';

  return <ReportSection title="Department-wise developer ratings">
    <p className="mb-4 text-[11px] text-slate-500">Ratings use synchronized commit activity, code contribution, and Taiga completion evidence for this report period.</p>
    {working.departments.length === 0 ? (
      <p className="text-xs text-slate-400">No developer activity was reported.</p>
    ) : (
      <div className="space-y-4">
        {working.departments.map((department, departmentIndex) => (
          <div key={department.departmentId || department.department + '-' + departmentIndex} className="border border-slate-200">
            <div className="bg-slate-50 border-b border-slate-200 px-3 py-2">
              <h4 className="text-xs font-bold">{department.department || 'Unassigned department'}</h4>
            </div>
            {department.employees.length === 0 ? (
              <p className="p-3 text-xs text-slate-400">No developers reported for this department.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {department.employees.slice().sort((a, b) => ratingOf(b).score - ratingOf(a).score).map((employee, employeeIndex) => {
                  const rating = ratingOf(employee);
                  return <div key={employee.employeeId || employee.email || employee.name + '-' + employeeIndex} className="flex items-center justify-between gap-3 px-3 py-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">{employee.name || employee.email || 'Unknown developer'}</p>
                      <p className="text-[10px] text-slate-500">{employee.gitCommits} commits · {employee.taigaTasksCompleted}/{employee.taigaTasksAssigned} Taiga tasks completed</p>
                    </div>
                    <div className={'shrink-0 rounded border px-3 py-1.5 text-right ' + tone(rating.score)}>
                      <div className="text-sm font-black tabular-nums">{rating.score}/100</div>
                      <div className="text-[9px] font-bold uppercase tracking-wider">{rating.label}</div>
                    </div>
                  </div>;
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    )}
  </ReportSection>;
};

const ReportSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => <div className="border border-slate-200 p-4"><h3 className="font-bold text-sm mb-2">{title}</h3>{children}</div>;
const Metric: React.FC<{ label: string; value: string | number }> = ({ label, value }) => <div className="bg-slate-50 border border-slate-200 p-2"><p className="text-[9px] uppercase text-slate-500">{label}</p><p className="text-sm font-bold">{value}</p></div>;
