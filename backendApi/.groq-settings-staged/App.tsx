import React, { useState, useEffect, useRef } from 'react';
import { Navbar, AiSyncStatus } from '@core/layouts/Navbar';
import { Sidebar, TabType } from '@core/layouts/Sidebar';
import { OverviewDashboard } from '@pages/common/OverviewDashboard';
import { AiIntelligence } from '@pages/common/AiIntelligence';
import { DepartmentHealth } from '@pages/csr-pages/DepartmentHealth';
import { LoginView } from '@pages/csr-pages/LoginView';
import { PortfolioDashboard } from '@pages/common/PortfolioDashboard';
import { IntegrationsView } from '@pages/csr-pages/IntegrationsView';
import { SettingsView } from '@pages/csr-pages/SettingsView';
import { ReportsView } from '@pages/csr-pages/ReportsView';
import { PlansView } from '@pages/csr-pages/PlansView';
import { Execution } from '@pages/csr-pages/project-Execution';
import { Health } from '@pages/csr-pages/project-Health';
import { ProjectDashboardSummary } from '@pages/csr-pages/project-ProjectDashboardSummary';
import type { ProjectOpenSnapshot } from '@core/services/portfolioCard';
import { ThemedLoader } from '@shared/components/ThemedLoader';
import {
  Project,
  Organization,
  AIPrediction,
  GitHubRepository,
  GitHubCommit,
  GitHubPullRequest,
  GitHubContributor,
  SyncLog,
  User,
  UserRole,
  AIProviderName,
  AIProviderConfig,
  CompletionForecast,
} from '@shared/models';
import { CalculatedAnalytics } from '@core/services/analytics-calculator';

import {
  listProjects,
  listOrganizations,
  getAnalytics,
  getRiskPrediction,
  getGitIntelligence,
  getSyncLogs,
  getCompletionForecast,
  runAIPrediction,
  triggerSync,
  syncProjectRepository,
  getAccess,
  clearAuth,
  getAIProviders,
  switchAIProvider,
  getModelPreference,
  setModelPreference,
} from '@core/services';

const ROLE_FROM_BACKEND: Record<string, UserRole> = {
  super_admin: 'ADMIN',
  org_admin: 'ADMIN',
  admin: 'ADMIN',
  project_manager: 'TECH_LEAD',
  member: 'DEVELOPER',
  viewer: 'DEVELOPER',
};

const DEFAULT_ORGANIZATION: Organization = {
  id: '6aa25d1cb8cdc6b232abe540',
  name: 'DevStudio Solutions',
  githubOrg: 'aiproject-org',
  taigaOrg: 'aiproject',
  createdAt: '',
};

const EmptyState: React.FC<{ title: string; hint: string }> = ({ title, hint }) => (
  <div className="p-6 bg-white border-2 border-slate-900 shadow-sm">
    <h1 className="text-lg font-black text-slate-900">{title}</h1>
    <p className="text-xs text-slate-600 font-mono mt-1">{hint}</p>
  </div>
);

export function App() {
  const [authed, setAuthed] = useState<boolean>(() => !!getAccess());
  const [activeTab, setActiveTab] = useState<TabType>('portfolio');

  const [organization, setOrganization] = useState<Organization>(DEFAULT_ORGANIZATION);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [analytics, setAnalytics] = useState<CalculatedAnalytics | null>(null);
  const [prediction, setPrediction] = useState<AIPrediction | null>(null);

  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [commits, setCommits] = useState<GitHubCommit[]>([]);
  const [pullRequests, setPullRequests] = useState<GitHubPullRequest[]>([]);
  const [contributors, setContributors] = useState<GitHubContributor[]>([]);
  const [forecast, setForecast] = useState<CompletionForecast | null>(null);

  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [providers, setProviders] = useState<AIProviderConfig[]>([]);
  const [users] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User>({
    id: '',
    name: '',
    email: '',
    role: 'DEVELOPER',
    avatar: '',
    organizationId: DEFAULT_ORGANIZATION.id,
  });

  const [isSyncing, setIsSyncing] = useState(false);
  const [isAiSyncing, setIsAiSyncing] = useState(false);
  const [aiSyncStatus, setAiSyncStatus] = useState<(AiSyncStatus & { projectId: string }) | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  // Portfolio card data handed to Overview on "Open", and which project the
  // shared project data was last loaded for (so Overview shows loading, not "empty").
  const [overviewSeed, setOverviewSeed] = useState<ProjectOpenSnapshot | null>(null);
  const [projectDataLoadedFor, setProjectDataLoadedFor] = useState('');
  const selectedProjectRef = useRef(selectedProjectId);
  useEffect(() => {
    selectedProjectRef.current = selectedProjectId;
  }, [selectedProjectId]);
  const [isPredicting, setIsPredicting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const loadProviders = async () => {
    try {
      const next = await getAIProviders();
      setProviders(next);
    } catch (err) {
      console.error('Provider config fetch error:', err);
      setProviders([]);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Bounce to login when a request hits an unrecoverable 401
  useEffect(() => {
    const handler = () => setAuthed(false);
    window.addEventListener('auth:unauthorized', handler);
    return () => window.removeEventListener('auth:unauthorized', handler);
  }, []);

  // Org-level data
  const loadOrgData = async () => {
    const [orgs, projs] = await Promise.all([
      listOrganizations(),
      listProjects(DEFAULT_ORGANIZATION.id),
    ]);
    const defaultOrganization = orgs.find((org) => org.id === DEFAULT_ORGANIZATION.id);
    setOrganization(defaultOrganization ?? DEFAULT_ORGANIZATION);
    setProjects(projs);
    setCurrentUser((c) => ({ ...c, organizationId: DEFAULT_ORGANIZATION.id }));
    setSelectedProjectId((cur) =>
      cur && projs.some((project) => project.id === cur) ? cur : projs[0]?.id || ''
    );
  };

  /**
   * Project-scoped data.
   *
   * Every call settles independently: one failing route (a 403 on the sync logs,
   * an expired token on git intelligence) must never wipe the whole workspace,
   * which is exactly what a bare `Promise.all` did — a single rejection left every
   * dataset empty and the AI tab showing "Invalid Date" / 0%.
   */
  const loadProjectData = async (projectId: string) => {
    const [anal, pred, gitData, sync, comp] = await Promise.allSettled([
      getAnalytics(projectId),
      getRiskPrediction(projectId),
      getGitIntelligence(projectId),
      getSyncLogs(projectId),
      getCompletionForecast(projectId),
    ]);

    if (anal.status === 'fulfilled') setAnalytics(anal.value);
    if (pred.status === 'fulfilled') setPrediction(pred.value);
    if (gitData.status === 'fulfilled') {
      setRepositories(gitData.value.repositories);
      setCommits(gitData.value.commits);
      setPullRequests(gitData.value.pullRequests);
      setContributors(gitData.value.contributors);
    }
    if (sync.status === 'fulfilled') setSyncLogs(sync.value.logs);
    if (comp.status === 'fulfilled') setForecast(comp.value);
  };

  useEffect(() => {
    if (!authed) return;
    let alive = true;
    (async () => {
      try {
        await Promise.all([loadOrgData(), loadProviders()]);
      } catch (err) {
        if (alive) console.error('Org data fetch error:', err);
      }
    })();
    return () => {
      alive = false;
    };
  }, [authed]);

  // Refresh AI providers whenever the Settings tab becomes active.
  // This ensures the Settings UI always displays the latest provider state,
  // especially after a provider switch that may have been persisted server‑side.
  // Refresh AI providers when Settings tab becomes active.
  // The provider load updates React state, so we invoke it inside an async
  // function to avoid ESLint's "setState in effect" warning.
  useEffect(() => {
    if (!authed) return;
    if (activeTab === 'settings') {
      (async () => {
        // Errors are already handled inside loadProviders.
        await loadProviders();
      })();
    }
  }, [authed, activeTab]);

  useEffect(() => {
    if (!authed) return;
    let alive = true;
    (async () => {
      if (!selectedProjectId) {
        setAnalytics(null);
        setPrediction(null);
        setRepositories([]);
        setCommits([]);
        setPullRequests([]);
        setContributors([]);
        setSyncLogs([]);
        setForecast(null);
        return;
      }
      try {
        await loadProjectData(selectedProjectId);
      } catch (err) {
        if (alive) console.error('Project data fetch error:', err);
      } finally {
        if (alive) setProjectDataLoadedFor(selectedProjectId);
      }
    })();
    return () => {
      alive = false;
    };
  }, [authed, selectedProjectId]);

  const refreshData = async () => {
    await loadOrgData();
    if (selectedProjectId) await loadProjectData(selectedProjectId);
  };

  const handleTriggerSync = async (actionType?: string) => {
    setIsSyncing(true);
    try {
      await triggerSync(actionType, selectedProjectId);
      showToast('Sync pipeline triggered.');
      await refreshData();
    } catch (err: any) {
      showToast(err?.msg || 'Sync pipeline unavailable.');
    } finally {
      setIsSyncing(false);
    }
  };

  // Header AI Sync for the selected project. The backend owns the GitHub-connected
  // check (400 NO_GITHUB_INTEGRATION), cooldown (429) and in-progress guard (409).
  // On success every tab refreshes together: shared data reloads and `dataVersion`
  // remounts the active tab so its own fetches rerun.
  const handleAiSync = async () => {
    const projectId = selectedProjectId;
    if (!projectId || isAiSyncing) return;
    setIsAiSyncing(true);
    try {
      const result = await syncProjectRepository(projectId, { trigger: 'central' });
      const partial = String(result?.status || 'success').toLowerCase() === 'partial';
      const text = partial ? 'Synced with warnings' : 'Synced';
      setAiSyncStatus({ projectId, tone: partial ? 'warning' : 'success', text: `${text} · ${new Date().toLocaleTimeString()}` });
      showToast(partial ? 'AI context refreshed with warnings.' : 'AI context synced.');
      // Ignore the refresh if the user switched projects mid-sync.
      if (selectedProjectRef.current === projectId) {
        await refreshData();
        setDataVersion((v) => v + 1);
      }
    } catch (err: any) {
      const next = err?.dataset?.next_sync_available_at;
      const msg = err?.dataset?.code === 'SYNC_COOLDOWN' && next
        ? `Synced recently. Next sync at ${new Date(next).toLocaleTimeString()}`
        : err?.msg || err?.message || 'AI sync failed.';
      setAiSyncStatus({ projectId, tone: err?.dataset?.code === 'SYNC_COOLDOWN' ? 'warning' : 'error', text: msg });
      showToast(msg);
    } finally {
      setIsAiSyncing(false);
    }
  };

  const handleRunPrediction = async (_customPrompt?: string, provider?: AIProviderName) => {
    if (!selectedProjectId) return;
    setIsPredicting(true);
    try {
      const activeP = provider || 'gemini';
      const newPred = await runAIPrediction(selectedProjectId, activeP);
      if (newPred) {
        setPrediction(newPred);
        showToast('AI prediction recalculated.');
        await refreshData();
      }
    } catch (err: any) {
      showToast(err?.msg || 'Prediction endpoint unavailable.');
    } finally {
      setIsPredicting(false);
    }
  };

  const handleSelectRole = (role: UserRole) => {
    const matchedUser = users.find((u) => u.role === role) || { ...currentUser, role };
    setCurrentUser(matchedUser);
    showToast(`Switched active role view to: ${role}`);
  };

  const handleSignOut = () => {
    clearAuth();
    setAuthed(false);
    setProjects([]);
    setSelectedProjectId('');
    setOrganization(DEFAULT_ORGANIZATION);
    showToast('Signed out');
  };

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const activeProviderConfig = providers.find((p) => p.active);
  const activeProvider: AIProviderName = activeProviderConfig?.provider || 'GEMINI';
  const activeModel = activeProviderConfig
    ? getModelPreference(activeProviderConfig.type) || activeProviderConfig.modelName
    : '';
  const orgId = currentUser.organizationId || organization?.id || '';
  const orgName = organization?.name || '';

  const handleSelectProvider = async (provider: AIProviderName, model: string) => {
    try {
      // Attempt to persist the selection server‑side.
      const selected = await switchAIProvider(provider, model);
      if (selected.model) {
        setModelPreference(provider, selected.model);
        showToast(`Switched to ${provider} · ${selected.model}`);
        // Refresh the provider list to reflect server state.
        await loadProviders();
      } else {
        // Fallback to client‑only update if backend did not acknowledge.
        throw new Error('The backend did not confirm the selected model.');
      }
    } catch (err: any) {
      // On error keep client‑side behaviour and surface feedback.
      showToast(err?.msg || `Failed to switch provider ${provider}`);
    }
  };

  // Persist a per-provider model preference client-side. The backend selects
  // models from env (GEMINI_MODEL / GROQ_MODEL / OLLAMA_MODEL) and exposes no
  // model-switch route, so this preference (aipi_model:<PROVIDER>) is the
  // pluggable "configured model" knob surfaced in System Settings.
  const handleSelectModel = (provider: AIProviderName, model: string) => {
    setModelPreference(provider, model);
    showToast(`${provider} model set to ${model}`);
  };

  if (!authed) {
    return (
      <LoginView
        onSuccess={(u) => {
          setCurrentUser((c) => ({
            ...c,
            id: u.id || c.id,
            email: u.email || c.email,
            name: c.name || (u.email ? u.email.split('@')[0] : ''),
            role: (u.role && ROLE_FROM_BACKEND[u.role]) || c.role,
          }));
          setActiveTab('portfolio');
          setAuthed(true);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white text-xs font-mono uppercase tracking-wider px-4 py-3 border-2 border-indigo-500 shadow-xl flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}

      <Navbar
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={(id) => setSelectedProjectId(id)}
        currentUser={currentUser}
        onSelectRole={handleSelectRole}
        users={users}
        onTriggerSync={() => handleTriggerSync()}
        isSyncing={isSyncing}
        onAiSync={() => void handleAiSync()}
        isAiSyncing={isAiSyncing}
        aiSyncStatus={aiSyncStatus?.projectId === selectedProjectId ? aiSyncStatus : null}
        onSignOut={handleSignOut}
      />

      <div className="flex-1 flex flex-col md:flex-row max-w-7xl w-full mx-auto p-3 sm:p-4 gap-4 md:gap-6">
        <Sidebar
          activeTab={activeTab}
          onTabChange={(tab) => setActiveTab(tab)}
          delayRisk={prediction?.delayProbability ?? selectedProject?.delayProbability ?? 0}
          hasProject={!!selectedProjectId}
        />

        {/* Keyed by dataVersion so a completed AI Sync remounts and refetches the open tab. */}
        <main key={dataVersion} className="flex-1 min-w-0">
          {activeTab === 'portfolio' && (
            <PortfolioDashboard
              organizationName={orgName}
              organizationId={orgId}
              ownerId={currentUser.id}
              selectedProjectId={selectedProjectId}
              onOpenProject={(id, snapshot) => {
                setOverviewSeed(snapshot ?? null);
                setSelectedProjectId(id);
                setActiveTab('overview');
              }}
              onProjectCreated={refreshData}
              onToast={showToast}
            />
          )}

          {activeTab === 'overview' &&
            (selectedProjectId ? (
              <div className="space-y-6">
                <ProjectDashboardSummary
                  key={selectedProjectId}
                  projectId={selectedProjectId}
                  projectName={selectedProject?.name}
                  projectDescription={selectedProject?.description}
                  seed={overviewSeed?.card.id === selectedProjectId ? overviewSeed : null}
                  onNavigateToReports={() => setActiveTab('reports')}
                />
                {projectDataLoadedFor !== selectedProjectId ? (
                  <div className="p-6 bg-white border border-slate-300 flex items-center justify-center text-slate-500 text-xs font-mono uppercase tracking-widest">
                    <ThemedLoader label="Loading project data" />
                  </div>
                ) : selectedProject && analytics ? (
                  <OverviewDashboard
                    project={selectedProject}
                    analytics={analytics}
                    prediction={prediction}
                    pullRequests={pullRequests}
                    commits={commits}
                    repositories={repositories}
                    forecast={forecast}
                    onNavigateToAi={() => setActiveTab('ai')}
                    onToast={showToast}
                  />
                ) : (
                  <EmptyState
                    title="No analytics bundle for this project"
                    hint="GET /projects/:id/analytics returned nothing. The project dashboard above is built from health, forecast and the latest AI report."
                  />
                )}
              </div>
            ) : (
              <EmptyState title="No project selected" hint="Open a project from Projects to see its workspace." />
            ))}

          {activeTab === 'plan' &&
            (selectedProjectId ? (
              <PlansView
                projectId={selectedProjectId}
                projectName={selectedProject?.name}
                onToast={showToast}
              />
            ) : (
              <EmptyState title="No project selected" hint="Open a project from Projects." />
            ))}

          {activeTab === 'execution' &&
            (selectedProjectId ? (
              <Execution
                projectId={selectedProjectId}
                onToast={showToast}
                repositories={repositories}
                commits={commits}
                pullRequests={pullRequests}
                contributors={contributors}
              />
            ) : (
              <EmptyState title="No project selected" hint="Open a project from Projects." />
            ))}

          {activeTab === 'health' &&
            (selectedProjectId ? (
              <Health key={selectedProjectId} projectId={selectedProjectId} organizationId={orgId} onToast={showToast} />
            ) : (
              <EmptyState title="No project selected" hint="Open a project from Projects." />
            ))}

          {activeTab === 'departments' && (
            <DepartmentHealth
              organizationId={orgId}
              projectId={selectedProjectId}
              onOpenRepositorySettings={() => setActiveTab('integrations')}
            />
          )}

          {activeTab === 'ai' &&
            (selectedProjectId && analytics ? (
              <AiIntelligence
                key={selectedProjectId}
                projectId={selectedProjectId}
                prediction={prediction}
                analytics={analytics}
                onRunPrediction={handleRunPrediction}
                isPredicting={isPredicting}
                activeProvider={activeProvider}
                activeModel={activeModel}
              />
            ) : (
              <EmptyState
                title="AI assistant unavailable"
                hint="The analytics bundle for this project is required and was not returned by the backend."
              />
            ))}

          {activeTab === 'reports' &&
            (selectedProjectId ? (
              <ReportsView
                projectId={selectedProjectId}
                projectName={selectedProject?.name}
                onToast={showToast}
              />
            ) : (
              <EmptyState title="No project selected" hint="Open a project from Projects." />
            ))}

          {activeTab === 'integrations' &&
            (selectedProjectId ? (
              <IntegrationsView
                projectId={selectedProjectId}
                projectName={selectedProject?.name}
                onToast={showToast}
              />
            ) : (
              <EmptyState title="No project selected" hint="Open a project from Projects." />
            ))}

          {activeTab === 'settings' && (
            <SettingsView
              providers={providers}
              onSelectProvider={handleSelectProvider}
              onSelectModel={handleSelectModel}
              currentUser={currentUser}
              organizationName={orgName}
              projects={projects}
              onToast={showToast}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
