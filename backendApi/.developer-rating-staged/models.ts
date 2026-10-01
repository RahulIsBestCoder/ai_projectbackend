export type UserRole = 'ADMIN' | 'TECH_LEAD' | 'ENG_MANAGER' | 'DEVELOPER';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string;
  organizationId: string;
}

export interface Organization {
  id: string;
  name: string;
  githubOrg: string;
  taigaOrg: string;
  createdAt: string;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  deadline: string;
  healthScore: number; // 0-100
  delayProbability: number; // 0-100%
  status: 'ON_TRACK' | 'AT_RISK' | 'DELAYED';
  keyRiskFactors: string[];
  lastSyncAt: string;
}

export interface GitHubRepository {
  id: string;
  projectId: string;
  repoName: string;
  defaultBranch: string;
  stars: number;
  openIssues: number;
  lastSyncAt: string;
}

export interface GitHubCommit {
  id: string;
  repositoryId: string;
  sha: string;
  author: string;
  authorAvatar?: string;
  commitDate: string;
  message: string;
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface GitHubPullRequest {
  id: string;
  repositoryId: string;
  number: number;
  title: string;
  author: string;
  status: 'OPEN' | 'MERGED' | 'CLOSED';
  createdAt: string;
  mergedAt?: string;
  reviewTimeHours: number;
  commentsCount: number;
}

export interface GitHubContributor {
  id: string;
  repositoryId: string;
  username: string;
  avatarUrl: string;
  totalCommits: number;
  totalAdditions: number;
  totalDeletions: number;
}

export interface TaigaSprint {
  id: string;
  projectId: string;
  name: string;
  startDate: string;
  endDate: string;
  totalPoints: number;
  completedPoints: number;
  isClosed: boolean;
  /** Taiga milestone id used to associate mirrored Taiga tasks with this sprint. */
  taigaMilestoneId?: number | null;
}

export type VelocityTrendDirection =
  | 'increasing'
  | 'decreasing'
  | 'stable'
  | 'insufficient_data';

export interface SprintVelocityPoint {
  sprintId: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  plannedPoints: number;
  completedPoints: number;
  completionRate: number | null;
  isCurrent: boolean;
}

export interface SprintVelocity {
  unit: 'story_points';
  historyLimit: number;
  sampleSize: number;
  displayedSprintCount: number;
  projectAverage: number | null;
  last3Average: number | null;
  selectedSprintCompletedPoints: number;
  latestCompletedSprintPoints: number | null;
  previousCompletedSprintPoints: number | null;
  changePoints: number | null;
  changePercent: number | null;
  trendDirection: VelocityTrendDirection;
  sprints: SprintVelocityPoint[];
}

export interface SprintVelocityResponse {
  sprint: {
    id: string;
    projectId: string;
    name: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    plannedPoints: number;
    completedPoints: number;
  };
  velocity: SprintVelocity;
}

export interface TaigaStory {
  id: string;
  projectId: string;
  sprintId: string;
  subject: string;
  storyPoints: number;
  status: 'BACKLOG' | 'IN_PROGRESS' | 'IN_TESTING' | 'DONE';
  assignedTo: string;
  type: 'FEATURE' | 'BUG' | 'REFACTOR' | 'TECH_DEBT';
  source?: 'work_item' | 'taiga_task';
  statusName?: string;
  statusColor?: string;
  userStorySubject?: string;
}

export interface TaigaTask {
  id: string;
  storyId: string;
  subject: string;
  status: 'NEW' | 'IN_PROGRESS' | 'READY_FOR_TEST' | 'CLOSED';
  assignedTo: string;
}

export interface TaigaIssue {
  id: string;
  projectId: string;
  subject: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  assignedTo: string;
  createdAt: string;
}

export type TeamRoleLevel = 'TECH_LEAD' | 'SENIOR' | 'JUNIOR' | 'FRESHER';

export interface DeveloperMetric {
  id: string;
  developerId: string;
  developerName: string;
  avatar: string;
  roleLevel: TeamRoleLevel;
  commitCount: number;
  codeChurn: number; // total lines changed
  reviewTimeHours: number; // avg PR review time
  bugsAssigned: number;
  bugsResolved: number;
  velocityPoints: number;
  aiScore: number; // 0-100 developer efficiency rating
  workloadStatus: 'OPTIMAL' | 'OVERLOADED' | 'UNDERUTILIZED';
}

export interface AIPrediction {
  id: string;
  projectId: string;
  delayProbability: number; // e.g. 78%
  predictedFinishDate: string; // ISO string
  confidence: number; // e.g. 89%
  projectHealth: number; // 0-100
  recommendations: string[];
  featureImportances: {
    feature: string;
    weight: number; // -100 to +100
    description: string;
  }[];
  teamCompositionSummary: {
    techLeads: number;
    seniors: number;
    juniors: number;
    freshers: number;
    qaCapacityPercentage: number;
  };
  aiProviderUsed: string;
  generatedAt: string;
}

export interface SyncLog {
  id: string;
  timestamp: string;
  status: 'SUCCESS' | 'WARNING' | 'FAILED' | 'IN_PROGRESS';
  message: string;
  recordsSynced: {
    commits: number;
    prs: number;
    stories: number;
    tasks: number;
  };
}

export type AIProviderName = 'GEMINI' | 'GROQ' | 'OPENAI' | 'CLAUDE' | 'DEEPSEEK' | 'OLLAMA' | 'NVIDIA';

export interface AIProviderConfig {
  provider: AIProviderName;
  /** Raw backend provider key used for provider switching and model preferences. */
  type: string;
  /** Model the backend resolves for this provider (env GEMINI_MODEL / GROQ_MODEL / OLLAMA_MODEL). */
  modelName: string;
  /** Model catalog from GET /v1/ai/models (the active provider's list, per the backend). */
  models: string[];
  active: boolean;
  apiKeySet: boolean;
  reachable?: boolean;
  ready?: boolean;
  error?: string | null;
  isDefault?: boolean;
  endpointUrl?: string;
  /** Sliding 5h token usage folded into GET /v1/ai/providers by the backend. */
  tokenUsage5h?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    requests?: number;
  };
  lastUsageAt?: string;
}

// ---------------------------------------------------------------------------
// Workforce — Departments, Teams, Employees, Org members
// ---------------------------------------------------------------------------

export interface Department {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
}

export interface DepartmentMetrics {
  departmentId: string;
  totalItems: number;
  statusBreakdown: Record<string, number>;
  completionRate: number; // 0-100
  plannedPoints: number;
  completedPoints: number;
}

export interface Team {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  memberIds?: string[];
}

export interface Employee {
  id: string;
  fullName: string;
  email: string;
  designation: string;
  departmentId?: string;
  role: UserRole;
}

export interface OrgMember {
  userId: string;
  fullName: string;
  email: string;
  role: string;
}

// ---------------------------------------------------------------------------
// Plans — AI sprint plan generator (POST /v1/plans). Shapes mirror
// planimplement.md §9, camelCased because `fromApi` runs on every response.
// ---------------------------------------------------------------------------

/** Request body for POST /v1/plans (sent through `toApi` -> snake_case). */
export interface GeneratePlanInput {
  description: string;
  projectName?: string;
  projectId?: string;
  teamSize?: number; // legacy — prefer teamBreakdown; kept in type so old saved plans still read back
  /** Department-wise team sizes, e.g. `{ ui: 2, backend: 3 }` — the total implies team_size. */
  teamBreakdown?: { ui?: number; backend?: number; app?: number; others?: number };
  durationWeeks?: number;
  sprintLengthWeeks?: number;
  startDate?: string; // YYYY-MM-DD
  deadline?: string; // YYYY-MM-DD — the AI plans to complete by this date
  rules?: string; // planning rules / scope the AI must follow strictly
  features?: string[]; // one feature per line — also merged into `constraints` below
  constraints?: string[];
}

export interface PlanTask {
  title: string;
  description?: string;
  type?: string; // story | task | bug
  priority?: string; // low | medium | high | critical
  assigneeRole?: string; // frontend | backend | fullstack | qa | devops | design
  estimateHours?: number;
  storyPoints?: number;
}

export interface PlanSprint {
  index: number;
  name: string;
  goal?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  deadline: string;
  plannedPoints?: number;
  tasks: PlanTask[];
}

export interface PlanMilestone {
  name: string;
  date?: string;
  description?: string;
}

export interface PlanDeadline {
  label: string;
  date?: string;
}

export interface PlanRisk {
  description: string;
  severity?: string; // low | medium | high | critical
  mitigation?: string;
}

/** The `plan` object nested in the generate response / saved documents. */
export interface SprintPlan {
  planName: string;
  summary: string;
  totalDurationWeeks?: number;
  sprints: PlanSprint[];
  milestones?: PlanMilestone[];
  deadlines?: PlanDeadline[];
  risks?: PlanRisk[];
  assumptions?: string[];
  generatedBy?: string;
}

/** `dataset` of POST /v1/plans. */
export interface GeneratedPlan {
  id: string;
  generatedBy: 'google' | 'heuristic-fallback' | string;
  model: string;
  input: GeneratePlanInput;
  plan: SprintPlan;
}

/** A saved plan document from GET /v1/plans / GET /v1/plans/:id. */
export interface SavedPlan {
  id: string;
  projectId: string | null;
  title: string;
  input: GeneratePlanInput;
  plan: SprintPlan;
  provider: string;
  model: string;
  createdAt: string;
  status?: 'draft' | 'accepted';
  acceptedAt?: string | null;
}

// ---------------------------------------------------------------------------
// Plan execution — server-side checklist created by POST /v1/plans/:id/accept
// ---------------------------------------------------------------------------

export type ExecutionKind = 'sprint' | 'task' | 'milestone' | 'deadline' | 'dependency';

export interface ExecutionItem {
  id: string;
  kind?: ExecutionKind;
  refKey?: string;
  parentKey?: string;
  title: string;
  description?: string;
  meta?: Record<string, any>;
  isCompleted: boolean;
  completedAt?: string | null;
}

export interface ExecutionProgress {
  byKind: Record<ExecutionKind, { total: number; completed: number }>;
  total: number;
  completed: number;
  percent: number;
}

export interface PlanExecution {
  plan: {
    id: string;
    title: string;
    status: 'draft' | 'accepted';
    acceptedAt: string | null;
    projectId: string | null;
  };
  progress: ExecutionProgress;
  sprints: Array<ExecutionItem & { tasks: ExecutionItem[]; dependencies: ExecutionItem[] }>;
  milestones: ExecutionItem[];
  deadlines: ExecutionItem[];
}

/** Counters for one Taiga entity stage (publish/preview envelope). */
export interface TaigaStageCounts {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

/** One internal-plan-key -> Taiga-object link (the idempotency map). */
export interface TaigaMappingRow {
  sourceType: 'sprint' | 'user_story' | 'task';
  sourceId: string;
  taigaType: 'milestone' | 'userstory' | 'task';
  taigaId: number;
  taigaRef?: number;
}

/** Non-fatal note: e.g. a task whose role has no mapped Taiga user. */
export interface TaigaSyncWarning {
  sourceId: string;
  type: 'USER_ROLE_UNMAPPED' | 'STATUS_FALLBACK' | 'INVALID_DATE';
  value?: string;
}

/** A per-entity failure. */
export interface TaigaSyncError {
  sourceId: string;
  entityType: string;
  field?: string;
  error: string;
}

/**
 * Result of `POST /v1/plans/:planId/create-in-taiga` and its `preview` sibling.
 *
 * Sprint-level mapping: one milestone + one user story per sprint, with that
 * sprint's tasks under the story — so `summary.milestones.created` and
 * `summary.userStories.created` are normally equal (a difference means a sprint
 * is missing its user story). `tasks.created` is the total across all sprints.
 */
export interface PlanTaigaSyncResult {
  syncId: string;
  status: 'completed' | 'partial' | 'failed';
  dryRun: boolean;
  mode: 'create' | 'sync';
  planId: string;
  taigaProject: { id: number | null; slug: string; name: string | null };
  summary: {
    milestones: TaigaStageCounts;
    userStories: TaigaStageCounts;
    tasks: TaigaStageCounts;
  };
  mappings: TaigaMappingRow[];
  warnings: TaigaSyncWarning[];
  errors: TaigaSyncError[];
  startedAt: string;
  finishedAt: string;
  /** Legacy fields the backend still returns alongside the envelope above. */
  publishId?: string;
  taigaProjectId?: number | null;
  taigaProjectSlug?: string;
  missingAssigneeMappings?: string[];
}

/** `GET /v1/plans/:planId/taiga-sync` — publish state + mapping summary. */
export interface PlanTaigaSyncStatus {
  planId: string;
  planPublished: boolean;
  status: 'idle' | 'completed' | 'partial' | 'failed';
  publishStatus: 'completed' | 'partial' | null;
  publishedAt: string | null;
  taigaProjectId: number | null;
  lastSyncAt: string | null;
  summary: { milestones: number; userStories: number; tasks: number };
  failedCount: number;
  failed: Array<{ sourceId: string; entityType: string; error: string | null }>;
}

/**
 * The plan the team has committed to for a project. The backend has no plan
 * "status" field and no manual-create route, so this is persisted client-side
 * (localStorage, per project) — see `lib/acceptedPlan.ts`.
 */
export interface AcceptedPlanRecord {
  source: 'ai' | 'manual';
  acceptedAt: string; // ISO
  planId?: string; // backend id when source === 'ai'
  generatedBy?: string;
  model?: string;
  plan: SprintPlan; // possibly hand-edited
}

/**
 * An **edited plan saved as a draft** before it is accepted/published. Persisted
 * client-side (localStorage, per project) — see `lib/planDraft.ts` — so the
 * user's edits survive a refresh / project switch / browser close. `baseline`
 * is what the plan looked like before the edits (last AI generation, or the
 * accepted plan being edited) so the "edited parts" diff and the Execution
 * publish-diff keep working after a resume.
 */
export interface PlanDraftRecord {
  savedAt: string; // ISO
  source: 'ai' | 'manual';
  plan: SprintPlan; // the edited plan
  baseline: SprintPlan | null; // pre-edit copy (`pristine` / `editBaseline`)
  planId?: string;
  generatedBy?: string;
  model?: string;
  editingAccepted: boolean; // in-flight "Edit plan" session on an accepted plan
  input?: GeneratePlanInput; // the brief, so "Regenerate" can re-POST after a resume
}

// ---------------------------------------------------------------------------
// Risk & Prediction
// ---------------------------------------------------------------------------

export interface ProjectRiskRow {
  id?: string;
  riskType: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  mitigated: boolean;
}

export interface RiskAnalyzeResult {
  score: number; // 0-1
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  signals: Record<string, number>;
  topDriver?: string;
}

export interface CompletionForecast {
  /** `YYYY-MM-DD`, or null when the forecast is `insufficient_data`. */
  p50: string | null;
  p80: string | null;
  p95: string | null;
  /** Optional — not every backend build sends these yet. */
  onTimeProbability?: number | null; // 0-1
  confidencePct?: number | null; // 0-100
  /** `complete` | `insufficient_data` | `simulated`. */
  status?: string | null;
  /** Human-readable explanation of why the forecast is unavailable. */
  message?: string | null;
}

// --- Risk analyze (POST /v1/projects/:id/risks/analyze) --------------------
// Shapes mirror the backend guide; camelCased because `fromApi` runs on every
// response (`risk_level` -> `riskLevel`, `_id` -> `id`, `top_risk` -> `topRisk`).

export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type RiskSource = 'deterministic' | 'ai';

export interface GeneratedRisk {
  riskKey: string;
  riskLevel: RiskLevel;
  summary: string;
  factors: string[];
  mitigation?: string;
  confidenceScore: number; // 0..1
  source?: RiskSource; // absent => a hand-created ("Manual") row
}

export interface RiskAnalysisResult {
  projectId: string;
  generatedAt: string; // ISO
  overallRiskLevel: RiskLevel;
  counts: Partial<Record<RiskLevel, number>>;
  aiUsed: boolean;
  risks: GeneratedRisk[];
}

export interface RiskRow extends GeneratedRisk {
  id: string;
  kind: 'risk';
  createdAt: string;
  generatedAt?: string;
}

export interface RiskListResult {
  rows: RiskRow[];
  count: number;
  counts: Partial<Record<RiskLevel, number>>;
  topRisk: { level: RiskLevel; summary: string; factors: string[] } | null;
}

// --- Stored project context (GET/POST /v1/ai/projects/:id/ai/context) -----

export type ContextTrigger = 'plan_accept' | 'git_sync' | 'taiga_sync' | 'manual';

export interface ProjectContextSnapshot {
  text: string;
  generatedBy: 'ai' | 'heuristic';
  sources: string[]; // ['project','analytics','risks','sprints','work_items','plan_execution']
  lineCount: number;
  charCount: number;
  trigger: ContextTrigger;
  updatedAt: string; // ISO
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export interface ReportChart {
  id: 'work_completion' | 'plan_vs_actual' | 'git_activity' | 'pull_request_merge' | 'code_changes' | 'taiga_work_status';
  type: 'pie' | 'bar' | 'line';
  title: string;
  labels: string[];
  datasets: Array<{ label: string; data: Array<number | null> }>;
}

export interface GeneratedReport {
  taigaSprintSummary?: {
    source: string; lastSyncedAt: string | null; totalTasks: number; note: string;
    rows: Array<{ milestoneId: string | null; sprintName: string; startDate: string | null;
      total: number; closed: number; blocked: number; statuses: Array<{ name: string; count: number }> }>;
  };
  report: {
    schemaVersion: 'project-report.v1'; title: string; project: { id: string; name: string };
    type: 'latest_project_review' | 'sprint_review';
    sprint?: { id: string; name: string; milestoneId: number | null } | null;
    period: { type: 'latest' | 'sprint'; label: string; startDate: string | null; endDate: string };
    status: 'completed'; generatedAt: string; generatedBy: 'ai' | 'heuristic'; generationError: string | null;
    evidenceGenerationError: string | null; sources: string[]; repositoryCount: number;
  };
  executiveSummary: { summary: string; overallProgress: number; completedTasks: number; totalTasks: number; completionRate: number; remainingProgress: number };
  healthAndTrend: { overallHealth: 'healthy' | 'attention' | 'critical' | 'unknown'; healthScore: number | null; trend: 'improving' | 'declining' | 'stable' | 'unknown'; previousScore: number | null; currentScore: number | null; factors: Array<{ name: string; score: number; status: 'good' | 'attention' | 'critical' }> };
  velocityAndSprint: { sprintName: string | null; plannedPoints: number; completedPoints: number; velocity: number | null; completionRate: number; previousVelocity: number | null; velocityTrend: 'improving' | 'declining' | 'stable' | 'unknown' };
  risksAndPredictions: { overallRisk: string; deadlineRisk: 'low' | 'medium' | 'high' | 'unknown'; risks: Array<{ title: string; severity: string; probability: number; impact: string; status: string; recommendation: string }>; predictions: { deadlineProbability: number | null; expectedCompletionDate: string | null; delayProbability: number | null } };
  workBreakdown: { totalTasks: number; completed: number; inProgress: number; blocked: number; notStarted: number; byFeature: Array<{ featureId: string; featureName: string; plannedTasks: number; completedTasks: number; progress: number; status: 'implemented' | 'partial' | 'not_implemented' | 'unknown'; evidence: string[] }>; byDepartment: Array<{ department: string; totalTasks: number; completedTasks: number; progress: number }> };
  employeeWorking: {
    departments: Array<{
      departmentId: string;
      department: string;
      gitCommits: number;
      taigaTasksAssigned: number;
      taigaTasksCompleted: number;
      taigaBugsAssigned: number;
      taigaBugsSolved: number;
      employees: Array<{
        employeeId: string;
        name: string;
        email: string;
        designation: string;
        departmentId: string;
        department: string;
        gitCommits: number;
        gitAdditions: number;
        gitDeletions: number;
        taigaTasksAssigned: number;
        taigaTasksCompleted: number;
        taigaBugsAssigned: number;
        taigaBugsSolved: number;
        activityScore?: number;
        activityRating?: 'Exceptional' | 'Strong' | 'Good' | 'Developing' | 'Limited evidence';
        ratingBasis?: string;
      }>;
    }>;
    totals: {
      employees: number;
      gitCommits: number;
      taigaTasksAssigned: number;
      taigaTasksCompleted: number;
      taigaBugsAssigned: number;
      taigaBugsSolved: number;
    };
  };
  planAndActual: { plan: unknown; checkedExecution: unknown; implementationAnalysis: unknown; completePercent: number; remainingPercent: number; calculationBasis: string };
  repositoryActivity: { total: number; synced: number; items: Array<{ repositoryFullName: string; branch: string; syncStatus: string; updatedAt?: string; githubUpdatedAt?: string }> };
  gitActivity: { windowDays: number; commits: number; commitRatePerWeek: number; pullRequests: number; mergedPullRequests: number; mergeRatePercent: number; weeklyActivity: Array<{ week: string; commits: number; pullRequests: number; mergedPullRequests: number; additions: number; deletions: number }> };
  aiNarrative: { summary: string; whatWentWell: string[]; whatNeedsAttention: string[]; recommendations: Array<{ action: string; priority: 'low' | 'medium' | 'high'; expectedImpact?: string; owner?: string; dueDate?: string }> };
  visualData: ReportChart[];
}

export interface ReportItem {
  id: string;
  projectId: string;
  name: string;
  format?: 'pdf' | 'html' | 'ppt';
  content?: string;
  status?: 'generating' | 'generated' | 'generated_with_fallback' | 'pending' | 'processing' | 'completed' | 'failed';
  reportContent?: string;
  generationKey?: string;
  artifactUrl?: string;
  generatedAt?: string;
  createdAt?: string;
  reportData?: GeneratedReport;
  cacheHit?: boolean;
  definition?: { type?: string; period?: string; reportType?: 'project' | 'sprint'; sprintId?: string | null; generatedReport?: GeneratedReport };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationTriggerType =
  | 'risk_alert'
  | 'deadline_slip'
  | 'sync_failed'
  | 'sprint_closeout'
  | 'report_ready'
  | 'mention'
  | 'assignment';

export interface AppNotification {
  id: string;
  type: NotificationTriggerType | string;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreference {
  eventType: string;
  inApp: boolean;
  email: boolean;
}

// ---------------------------------------------------------------------------
// Analytics — health strategy / components / trends
// ---------------------------------------------------------------------------

export interface HealthStrategy {
  id: string;
  name: string;
}

export interface ProjectHealthDetail {
  score: number | null;
  calculationVersion: string;
  evaluationStrategy: string;
  lastEvaluated: string;
  components: Record<string, number | null>; // null means insufficient evidence
}

export interface TrendPoint {
  date: string;
  value: number;
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export interface IntegrationRow {
  id: string;
  provider: string; // github | gitlab | taiga | jira | planner | azure_devops | other
  repositoryName: string;
  repositoryUrl?: string;
  repositoryOrganization?: string;
  projectId?: string;
  token?: string;
  /** Active Git branch this integration syncs (GitHub). Falls back to the repo default when empty. */
  branch?: string;
  /** Team/purpose chosen from the dropdown when linking: ui | backend | apps | shared | other. */
  category?: string;
  /** Provider account username (e.g., Taiga) — used by the backend to obtain and cache a token on first sync. */
  username?: string;
  /** Provider account password (e.g., Taiga). Stored on the integration document; never rendered. */
  password?: string;
  status: number; // 0 inactive | 1 active | 2 error
  syncStatus?: string; // idle | syncing | success | partial | failed
  lastSyncAt?: string;
}

/** One dropdown option from GET /v1/git_intelligence/categories. */
export interface RepoCategoryOption {
  value: string;
  label: string;
  color: string;
  description?: string;
}

/** A row of GET /v1/integrations/:id/sync-history. */
export interface SyncHistoryRow {
  id?: string;
  createdAt: string;
  status: string; // success | partial | failed | error
  itemsSynced?: number;
  durationMs?: number;
  errorMessage?: string | null;
}

// ---------------------------------------------------------------------------
// Settings — backend feature flags (GET /v1/feature-flags, best effort)
// ---------------------------------------------------------------------------

export type FeatureFlagSource = 'backend' | 'derived' | 'env';

export interface FeatureFlag {
  key: string;
  value: boolean | string | number;
  source: FeatureFlagSource;
  description?: string;
}

export interface FeatureFlagsResult {
  flags: FeatureFlag[];
  /** 'backend' when /v1/feature-flags responded with rows; 'none' when it isn't exposed. */
  source: 'backend' | 'none';
  error?: string;
}
