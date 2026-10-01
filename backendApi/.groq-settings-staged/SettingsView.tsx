import React, { useEffect, useState } from 'react';
import {
  Sliders,
  Bot,
  CheckCircle2,
  Cpu,
  Plug,
  RefreshCw,
  Loader2,
  Github,
  Trello,
  Unplug,
} from 'lucide-react';
import {
  AIProviderName,
  AIProviderConfig,
  User,
  Project,
  IntegrationRow,
} from '@shared/models';
import {
  getModelPreference,
  setModelPreference,
  listWorkspaceIntegrations,
  syncIntegration,
  disconnectIntegration,
  summariseSync,
} from '@core/services';

interface SettingsViewProps {
  providers: AIProviderConfig[];
  onSelectProvider: (provider: AIProviderName, model: string) => Promise<void>;
  onSelectModel?: (provider: AIProviderName, model: string) => void;
  currentUser: User;
  organizationName?: string;
  projects: Project[];
  onToast: (m: string) => void;
}

const PROVIDER_DESC: Record<string, string> = {
  GEMINI: 'Google GenAI SDK — Default Production Engine',
  GROQ: 'Groq OpenAI-compatible API integration',
  OLLAMA: 'Local / Self-hosted Ollama endpoint',
};

const PROVIDER_ICON: Record<string, React.ElementType> = {
  github: Github,
  gitlab: Github,
  azure_devops: Github,
  taiga: Trello,
  jira: Trello,
  planner: Trello,
};

const STATUS_META: Record<number, { label: string; cls: string }> = {
  0: { label: 'Inactive', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
  1: { label: 'Active', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  2: { label: 'Error', cls: 'bg-rose-100 text-rose-800 border-rose-300' },
};

const statusMeta = (s: number) =>
  STATUS_META[s] ?? { label: `Status ${s}`, cls: 'bg-slate-100 text-slate-600 border-slate-300' };

const fmtDate = (iso?: string): string => {
  if (!iso) return 'never';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
};

export const SettingsView: React.FC<SettingsViewProps> = ({
  providers,
  onSelectProvider,
  onSelectModel,
  currentUser,
  organizationName,
  projects,
  onToast,
}) => {
  // --- Connected workspace integrations ---------------------------------------
  const [workspaceRows, setWorkspaceRows] = useState<IntegrationRow[] | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Model <select> drafts so the dropdown reflects the choice immediately.
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  const [switchingProvider, setSwitchingProvider] = useState<AIProviderName | null>(null);

  const reloadIntegrations = () =>
    listWorkspaceIntegrations(projects.map((p) => p.id)).then(setWorkspaceRows);

  // Aggregate the workspace's connected integrations whenever the project
  // list changes identity (App pushes a fresh array after reloads).
  useEffect(() => {
    if (!projects.length) {
      setWorkspaceRows([]);
      return;
    }
    let alive = true;
    void listWorkspaceIntegrations(projects.map((p) => p.id)).then((rows) => {
      if (alive) setWorkspaceRows(rows);
    });
    return () => {
      alive = false;
    };
  }, [projects]);

  const doSync = async (id: string | undefined) => {
    if (!id) return;
    setSyncingId(id);
    try {
      const r = await syncIntegration(id);
      onToast(summariseSync(r.itemsSynced));
      await reloadIntegrations();
    } catch (err: any) {
      onToast(err?.msg || 'Sync failed');
    } finally {
      setSyncingId(null);
    }
  };

  const removeIntegration = async (id: string | undefined) => {
    if (!id) return;
    setRemovingId(id);
    try {
      await disconnectIntegration('', id);
      onToast('Integration disconnected from workspace');
      await reloadIntegrations();
    } catch (err: any) {
      onToast(err?.msg || 'Could not disconnect the integration');
    } finally {
      setRemovingId(null);
    }
  };

  const activeProvider = providers.find((p) => p.active)?.provider || 'none';
  const projectName = (id?: string) => {
    if (!id) return '—';
    return projects.find((p) => p.id === id)?.name || '—';
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-6 bg-white border-2 border-slate-900 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-indigo-700 text-xs font-black uppercase tracking-widest mb-1">
            <Sliders className="w-4 h-4" />
            <span>Platform Configuration &amp; AI Providers</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">System Settings</h1>
          <p className="text-xs text-slate-600 font-mono mt-0.5">
            Configure pluggable AI models and manage connected workspace integrations.
          </p>
        </div>
        <div className="text-right text-[10px] font-mono text-slate-500 leading-relaxed">
          <div>
            Workspace: <strong className="text-slate-900">{organizationName || '—'}</strong>
          </div>
          <div>
            Signed in as: <strong className="text-slate-900">{currentUser.email || currentUser.name || '—'}</strong>
          </div>
        </div>
      </div>

      <div className="p-6 bg-white border-2 border-slate-900 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Pluggable AI Delivery Intelligence Providers
            </h2>
          </div>
          <span className="text-xs font-mono text-slate-500">
            Active: <strong className="text-indigo-700">{activeProvider}</strong>
          </span>
        </div>

        {providers.length === 0 ? (
          <div className="p-6 bg-slate-50 border border-dashed border-slate-300 text-center">
            <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">
              No AI providers reported by the backend
            </p>
            <p className="text-[10px] font-mono text-slate-400 mt-2">
              GET /v1/ai/providers returned an empty catalog — check that the backend is
              running and the provider factory is seeded (gemini / groq / ollama).
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {providers.map((p) => {
              const isActive = p.active;
              const type = p.type || p.provider.toLowerCase();
              const pref = getModelPreference(type);
              const draft = modelDrafts[p.provider];
              const chosenModel = draft !== undefined ? draft : pref || p.modelName || '';
              const modelOptions = [...new Set([...(p.models || []), p.modelName].filter(Boolean))];
              const canActivate = p.apiKeySet && Boolean(chosenModel.trim());
              return (
                <div
                  key={p.provider}
                  className={`p-4 border-2 transition flex flex-col justify-between space-y-3 ${
                    isActive
                      ? 'bg-indigo-50/50 border-indigo-600 shadow-xs'
                      : 'bg-white border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      <div
                        className={`w-9 h-9 border flex items-center justify-center font-bold text-xs ${
                          isActive
                            ? 'bg-indigo-600 text-white border-indigo-700'
                            : 'bg-slate-100 text-slate-600 border-slate-300'
                        }`}
                      >
                        <Bot className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-sm text-slate-900">{p.provider}</span>
                          <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 border border-slate-200">
                            {p.modelName}
                          </span>
                        </div>
                        <span className="text-xs text-slate-500 block mt-0.5">
                          {PROVIDER_DESC[p.provider] || `External ${p.provider} LLM API integration`}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Model selector — catalog from GET /v1/ai/models; the choice is kept
                      client-side (aipi_model:<PROVIDER>) because the backend resolves
                      models from env and has no model-switch route. */}
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Model
                  </label>
                  <input
                    type="text"
                    list={`models-${type}`}
                    value={chosenModel}
                    onChange={(e) => {
                      const model = e.target.value;
                      setModelDrafts((prev) => ({ ...prev, [p.provider]: model }));
                    }}
                    onBlur={(e) => {
                      const model = e.target.value.trim();
                      if (!model) return;
                      setModelDrafts((prev) => ({ ...prev, [p.provider]: model }));
                      setModelPreference(type, model);
                      onSelectModel?.(p.provider, model);
                    }}
                    placeholder="Enter model name"
                    className="w-full text-xs font-mono border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:border-indigo-500 focus:outline-none"
                  />
                  {modelOptions.length > 0 && (
                    <datalist id={`models-${type}`}>
                      {modelOptions.map((model) => (
                        <option key={model} value={model} />
                      ))}
                    </datalist>
                  )}
                  {!p.apiKeySet && (
                    <p className="text-[10px] font-mono text-amber-700">
                      {p.error || `Add ${p.provider === 'GROQ' ? 'GROQ_API_KEY' : `${p.provider}_API_KEY`} to the backend environment and restart it.`}
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 text-xs">
                    <span className="text-slate-500 font-mono text-[10px]">
                      Key Status:{' '}
                      <strong className={p.apiKeySet ? 'text-emerald-700' : 'text-amber-700'}>
                        {p.apiKeySet ? 'Configured' : 'Not configured'}
                      </strong>
                    </span>
                    <button
                      type="button"
                      disabled={!canActivate || switchingProvider !== null}
                      onClick={async () => {
                        setSwitchingProvider(p.provider);
                        try {
                          await onSelectProvider(p.provider, chosenModel);
                        } finally {
                          setSwitchingProvider(null);
                        }
                      }}
                      className="inline-flex items-center text-xs font-bold text-indigo-600 hover:text-indigo-800 uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {switchingProvider === p.provider && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                      {!p.apiKeySet ? 'API key required' : isActive ? 'Apply selection' : `Switch to ${p.provider}`}
                    </button>
                  </div>

                  {p.tokenUsage5h?.totalTokens != null && (
                    <span className="text-[10px] font-mono text-slate-400">
                      {p.tokenUsage5h.totalTokens} tokens / {p.tokenUsage5h.requests ?? 0} requests (sliding 5h window)
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="p-6 bg-white border-2 border-slate-900 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Plug className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Connected Workspace Integrations</h2>
          </div>
          <button
            onClick={() => void reloadIntegrations()}
            className="inline-flex items-center px-2.5 py-1.5 text-[10px] font-bold font-mono uppercase bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200 transition"
          >
            <RefreshCw className="w-3 h-3 mr-1" />
            Refresh
          </button>
        </div>

        {workspaceRows === null ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
            <span className="ml-2 text-xs font-mono text-slate-500 uppercase tracking-wider">Scanning workspace integrations…</span>
          </div>
        ) : workspaceRows.length === 0 ? (
          <div className="p-6 bg-slate-50 border border-dashed border-slate-300 text-center">
            <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">No connected workspace integrations</p>
            <p className="text-[10px] font-mono text-slate-400 mt-2">
              Link a GitHub repository or Taiga board from a project's Integrations tab —
              connected integration rows aggregate here across all {projects.length} projects in this workspace.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="text-left text-[9px] font-black uppercase tracking-widest text-slate-500 border-b border-slate-300">
                  <th className="py-1.5 pr-2">Provider</th>
                  <th className="py-1.5 pr-2">Repository / Board</th>
                  <th className="py-1.5 pr-2">Linked Project</th>
                  <th className="py-1.5 pr-2">Status</th>
                  <th className="py-1.5 pr-2">Last Sync</th>
                  <th className="py-1.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {workspaceRows.map((row) => {
                  const Icon = PROVIDER_ICON[row.provider.toLowerCase()] || Plug;
                  const st = statusMeta(row.status);
                  return (
                    <tr key={row.id || `${row.provider}:${row.repositoryName}`} className="border-b border-slate-200/60">
                      <td className="py-2 pr-2">
                        <span className="inline-flex items-center space-x-1.5">
                          <Icon className="w-4 h-4 text-slate-500" />
                          <span className="font-mono text-slate-800">{row.provider}</span>
                        </span>
                      </td>
                      <td className="py-2 pr-2 font-mono text-slate-800">{row.repositoryName}</td>
                      <td className="py-2 pr-2 text-slate-500">{projectName(row.projectId)}</td>
                      <td className="py-2 pr-2">
                        <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold font-mono uppercase border ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="py-2 pr-2 font-mono text-slate-500">{fmtDate(row.lastSyncAt)}</td>
                      <td className="py-2 text-right space-x-2">
                        <button
                          disabled={syncingId === row.id || removingId === row.id}
                          onClick={() => void doSync(row.id)}
                          className="inline-flex items-center px-2 py-1 text-[10px] font-bold font-mono uppercase bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition"
                        >
                          {syncingId === row.id ? (
                            <Loader2 className="w-3 h-3 text-indigo-600 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          <span className="ml-1">Sync</span>
                        </button>
                        <button
                          disabled={syncingId === row.id || removingId === row.id}
                          onClick={() => void removeIntegration(row.id)}
                          className="inline-flex items-center px-2 py-1 text-[10px] font-bold font-mono uppercase bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition"
                        >
                          {removingId === row.id ? (
                            <Loader2 className="w-3 h-3 text-rose-600 animate-spin" />
                          ) : (
                            <Unplug className="w-3 h-3" />
                          )}
                          <span className="ml-1">Unlink</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
