import dotenv from 'dotenv';

dotenv.config();

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * Minimal dictionary seed (MongoDB edition of AI_Project_DB_Dictionary_Mongo.md).
 *
 * Inserts one small, fully cross-referenced dataset covering every collection,
 * written parent-first in the L0 -> L6 order from the dictionary. Idempotent:
 * each collection is emptied before insert.
 *
 * Run: `npm run seed:mongo`
 */

const oid = () => new mongoose.Types.ObjectId();
const t = new Date();
const A = { created_at: t, updated_at: t };

// ---- pre-allocated ids (so foreign-key refs line up) ----
const U = { admin: oid(), pm: oid(), dev1: oid(), dev2: oid() };
const R = { admin: oid(), member: oid() };
const PERM = { read: oid(), write: oid() };
const ORG = oid();
const DEPT = oid();
const TEAM = oid();
const DESIG = oid();
const PROJ = oid();
const PROJ2 = oid();
const LABEL = oid();
const GACC = oid();
const REPO = oid();
const BRANCH = oid();
const COMMIT = oid();
const PR = oid();
const REVIEW = oid();
const RELEASE = oid();
const TPROJ = oid();
const TSTATUS = oid();
const TPRIO = oid();
const TSEV = oid();
const TEPIC = oid();
const TSTORY = oid();
const SPRINT = oid();
const WI1 = oid();
const WI2 = oid();
const AIPROV = oid();
const AIMODEL = oid();
const AICONV = oid();
const REPORT = oid();
const RHIST = oid();
const REXPORT = oid();
const NOTIF = oid();
const EMAILQ = oid();
const SJOB = oid();
const COUNTRY = oid();
const STATE = oid();

async function run(): Promise<void> {
  const uri = `${process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/'}${process.env.DB_NAME || 'ai_project'}`;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db!;
  let total = 0;

  const ins = async (name: string, docs: Record<string, unknown>[]): Promise<void> => {
    await db.collection(name).deleteMany({});
    if (docs.length) await db.collection(name).insertMany(docs);
    total += docs.length;
    // eslint-disable-next-line no-console
    console.log(`  ${name.padEnd(28)} ${docs.length}`);
  };

  const pwd = await bcrypt.hash(process.env.SEED_USER_PASSWORD || 'Admin@123', 10);

  // ===================================================================== L0
  console.log('L0  masters + roots');
  await ins('master_status', [
    { _id: oid(), name: 'open', description: 'Not started', ...A },
    { _id: oid(), name: 'in_progress', description: 'Being worked on', ...A },
    { _id: oid(), name: 'done', description: 'Completed', ...A },
  ]);
  await ins('master_priority', [
    { _id: oid(), name: 'low', ...A }, { _id: oid(), name: 'medium', ...A }, { _id: oid(), name: 'high', ...A },
  ]);
  await ins('master_severity', [
    { _id: oid(), name: 'minor', ...A }, { _id: oid(), name: 'major', ...A }, { _id: oid(), name: 'critical', ...A },
  ]);
  await ins('master_department', [{ _id: oid(), name: 'Engineering', ...A }]);
  await ins('master_designation', [{ _id: oid(), name: 'Software Engineer', ...A }]);
  await ins('master_project_type', [{ _id: oid(), name: 'Software', ...A }]);
  await ins('master_integration', [
    { _id: oid(), name: 'github', ...A }, { _id: oid(), name: 'taiga', ...A },
  ]);
  await ins('master_notification_type', [
    { _id: oid(), name: 'risk_alert', ...A }, { _id: oid(), name: 'sync_failed', ...A },
  ]);
  await ins('master_ai_provider', [
    { _id: oid(), name: 'anthropic', ...A }, { _id: oid(), name: 'openai', ...A },
  ]);
  await ins('master_country', [{ _id: COUNTRY, name: 'India', iso_code: 'IN', ...A }]);
  await ins('master_state', [{ _id: STATE, country_id: COUNTRY, name: 'West Bengal', iso_code: 'WB', ...A }]);
  await ins('master_city', [{ _id: oid(), state_id: STATE, name: 'Kolkata', ...A }]);
  await ins('master_language', [{ _id: oid(), name: 'English', iso_code: 'en', ...A }]);
  await ins('master_timezone', [{ _id: oid(), name: 'UTC', offset_hours: 0, ...A }]);
  await ins('master_currency', [{ _id: oid(), name: 'Indian Rupee', symbol: '₹', iso_code: 'INR', ...A }]);

  await ins('users', [
    { _id: U.admin, full_name: 'Admin User', email: process.env.SEED_USER_EMAIL || 'admin@aiproject.local', password_hash: pwd, is_active: true, deleted_at: null, ...A },
    { _id: U.pm, full_name: 'Priya Manager', email: 'pm@aiproject.local', password_hash: pwd, is_active: true, deleted_at: null, ...A },
    { _id: U.dev1, full_name: 'Dev One', email: 'dev1@aiproject.local', password_hash: pwd, is_active: true, deleted_at: null, ...A },
    { _id: U.dev2, full_name: 'Dev Two', email: 'dev2@aiproject.local', password_hash: pwd, is_active: true, deleted_at: null, ...A },
  ]);
  await ins('roles', [
    { _id: R.admin, name: 'org_admin', description: 'Organization administrator', deleted_at: null, ...A },
    { _id: R.member, name: 'member', description: 'Standard member', deleted_at: null, ...A },
  ]);
  await ins('permissions', [
    { _id: PERM.read, name: 'project.read', description: 'Read projects', deleted_at: null, ...A },
    { _id: PERM.write, name: 'project.write', description: 'Modify projects', deleted_at: null, ...A },
  ]);
  await ins('organizations', [{ _id: ORG, name: 'Acme Corp', description: 'Demo organization', deleted_at: null, ...A }]);
  await ins('ai_provider', [{ _id: AIPROV, name: 'anthropic', api_key: 'enc:demo', endpoint: 'https://api.anthropic.com', ...A }]);
  await ins('report_templates', [{ _id: oid(), name: 'Weekly Status', template_text: '# {{project}} weekly status', ...A }]);
  await ins('notification_templates', [{ _id: oid(), name: 'risk_alert', subject: 'Risk: {{project}}', body_template: 'Risk level {{level}}', ...A }]);
  await ins('scheduler_jobs', [{ _id: SJOB, name: 'analytics_calculation', cron_expression: '0 2 * * *', enabled: true, ...A }]);
  await ins('system_settings', [{ _id: oid(), key: 'platform.name', value: 'AI Project Intelligence', description: 'Display name', ...A }]);
  await ins('application_settings', [{ _id: oid(), key: 'api.version', value: 'v1', description: 'Active API version', ...A }]);
  await ins('ai_settings', [{ _id: oid(), key: 'ai.default_provider', value: 'anthropic', description: 'Default LLM provider', ...A }]);
  await ins('security_settings', [{ _id: oid(), key: 'jwt.expiry', value: '1h', description: 'Access token TTL', ...A }]);
  await ins('integration_settings', [{ _id: oid(), provider: 'github', key: 'api_base', value: 'https://api.github.com', description: 'GitHub REST base', ...A }]);
  await ins('feature_flags', [{ _id: oid(), name: 'ai_reports', enabled: false, description: 'AI-written reports', ...A }]);
  await ins('email_settings', [{ _id: oid(), smtp_server: 'smtp.example.com', smtp_port: 587, smtp_user: 'user', smtp_password: 'enc:pass', from_address: 'no-reply@aiproject.local', use_tls: true, ...A }]);
  await ins('storage_settings', [{ _id: oid(), provider: 'local', bucket_name: 'reports', region: 'local', access_key: 'enc:x', secret_key: 'enc:y', ...A }]);
  await ins('scheduler_configuration', [{ _id: oid(), key: 'timezone', value: 'UTC', description: 'Scheduler timezone', ...A }]);
  await ins('project_status', [
    { _id: oid(), name: 'active', description: 'Active project', ...A },
    { _id: oid(), name: 'archived', description: 'Archived project', ...A },
  ]);
  await ins('labels', [{ _id: LABEL, name: 'backend', color: '#3b82f6', ...A }]);
  await ins('designation', [{ _id: DESIG, name: 'Software Engineer', description: 'IC engineer', ...A }]);
  await ins('taiga_status', [{ _id: TSTATUS, name: 'New', description: 'New item', ...A }]);
  await ins('taiga_priorities', [{ _id: TPRIO, name: 'Normal', description: 'Normal priority', ...A }]);
  await ins('taiga_severity', [{ _id: TSEV, name: 'Normal', description: 'Normal severity', ...A }]);
  await ins('email_queue', [{ _id: EMAILQ, recipient_email: 'pm@aiproject.local', subject: 'Welcome', body: 'Hello', queued_at: t, status: 'queued', ...A }]);
  await ins('webhook_logs', [{ _id: oid(), webhook_url: 'https://hooks.example.com/x', payload: { event: 'ping' }, sent_at: t, status: 'ok', response_code: 200, response_body: 'ok', ...A }]);
  await ins('system_logs', [{ _id: oid(), level: 'info', message: 'seed run', logged_at: t, ...A }]);
  await ins('error_logs', [{ _id: oid(), error_message: 'none', stack_trace: '', occurred_at: t, ...A }]);
  await ins('historical_snapshots', [{ _id: oid(), entity_type: 'project', entity_id: PROJ, snapshot_date: t, data: { health: 72 }, ...A }]);
  await ins('daily_snapshots', [{ _id: oid(), entity_type: 'project', entity_id: PROJ, snapshot_date: t, data: { health: 72 }, ...A }]);
  await ins('weekly_snapshots', [{ _id: oid(), entity_type: 'project', entity_id: PROJ, week_start: t, data: { velocity: 20 }, ...A }]);
  await ins('monthly_snapshots', [{ _id: oid(), entity_type: 'project', entity_id: PROJ, month_start: t, data: { velocity: 82 }, ...A }]);

  // ===================================================================== L1
  console.log('L1  first-level children');
  await ins('role_permissions', [
    { _id: oid(), role_id: R.admin, permission_id: PERM.read, ...A },
    { _id: oid(), role_id: R.admin, permission_id: PERM.write, ...A },
    { _id: oid(), role_id: R.member, permission_id: PERM.read, ...A },
  ]);
  await ins('user_roles', [
    { _id: oid(), user_id: U.admin, role_id: R.admin, ...A },
    { _id: oid(), user_id: U.pm, role_id: R.member, ...A },
    { _id: oid(), user_id: U.dev1, role_id: R.member, ...A },
    { _id: oid(), user_id: U.dev2, role_id: R.member, ...A },
  ]);
  await ins('refresh_tokens', [{ _id: oid(), user_id: U.admin, token: 'demo-refresh', expires_at: new Date(Date.now() + 6048e5), ...A }]);
  await ins('login_history', [{ _id: oid(), user_id: U.admin, login_at: t, ip_address: '127.0.0.1', user_agent: 'seed', success: true, ...A }]);
  await ins('api_tokens', [{ _id: oid(), user_id: U.admin, token: 'demo-api', expires_at: new Date(Date.now() + 6048e5), ...A }]);
  await ins('password_history', [{ _id: oid(), user_id: U.admin, password_hash: pwd, changed_at: t, ...A }]);
  await ins('organization_settings', [{ _id: oid(), organization_id: ORG, key: 'default_timezone', value: 'UTC', ...A }]);
  await ins('organization_domains', [{ _id: oid(), organization_id: ORG, domain: 'acme.example.com', verified: true, ...A }]);
  await ins('organization_subscription', [{ _id: oid(), organization_id: ORG, plan_name: 'pro', start_date: t, end_date: null, status: 'active', ...A }]);
  await ins('organization_storage', [{ _id: oid(), organization_id: ORG, quota_gb: 50, used_gb: 2, ...A }]);
  await ins('departments', [{ _id: DEPT, organization_id: ORG, name: 'Engineering', description: 'Product engineering', ...A }]);
  await ins('teams', [{ _id: TEAM, organization_id: ORG, name: 'Platform Team', description: 'Backend platform', ...A }]);
  await ins('projects', [
    { _id: PROJ, organization_id: ORG, name: 'Mobile App', description: 'Flagship mobile app', status: 'active', deleted_at: null, ...A },
    { _id: PROJ2, organization_id: ORG, name: 'Design System', description: 'Shared component library', status: 'active', deleted_at: null, ...A },
  ]);
  await ins('employee_profile', [{ _id: oid(), user_id: U.dev1, designation_id: DESIG, hire_date: t, salary: 1200000, ...A }]);
  await ins('git_accounts', [{ _id: GACC, organization_id: ORG, provider: 'github', access_token: 'enc:gh', refresh_token: 'enc:ghr', token_expires_at: new Date(Date.now() + 6048e5), ...A }]);
  await ins('ai_models', [{ _id: AIMODEL, provider_id: AIPROV, name: 'claude-sonnet-5', version: '5', description: 'Default model', ...A }]);

  // ===================================================================== L2
  console.log('L2  second-level children');
  await ins('department_members', [{ _id: oid(), department_id: DEPT, user_id: U.dev1, role: 'engineer', ...A }]);
  await ins('team_members', [
    { _id: oid(), team_id: TEAM, user_id: U.dev1, role: 'engineer', ...A },
    { _id: oid(), team_id: TEAM, user_id: U.dev2, role: 'engineer', ...A },
  ]);
  await ins('project_settings', [{ _id: oid(), project_id: PROJ, key: 'sprint_length_days', value: '14', ...A }]);
  await ins('project_members', [
    { _id: oid(), project_id: PROJ, user_id: U.pm, role: 'project_manager', ...A },
    { _id: oid(), project_id: PROJ, user_id: U.dev1, role: 'developer', ...A },
    { _id: oid(), project_id: PROJ, user_id: U.dev2, role: 'developer', ...A },
  ]);
  await ins('project_departments', [{ _id: oid(), project_id: PROJ, department_id: DEPT, ...A }]);
  await ins('project_labels', [{ _id: oid(), project_id: PROJ, label_id: LABEL, ...A }]);
  await ins('project_milestones', [{ _id: oid(), project_id: PROJ, title: 'MVP Launch', description: 'First public release', due_date: new Date(Date.now() + 2592e6), status: 'open', ...A }]);
  await ins('project_calendar', [{ _id: oid(), project_id: PROJ, title: 'Sprint review', start_time: t, end_time: new Date(Date.now() + 36e5), description: 'Bi-weekly review', ...A }]);
  await ins('project_holidays', [{ _id: oid(), project_id: PROJ, name: 'Company Offsite', date: new Date(Date.now() + 12096e5), ...A }]);
  await ins('project_dependencies', [{ _id: oid(), project_id: PROJ, depends_on_id: PROJ2, ...A }]);
  await ins('sprints', [{ _id: SPRINT, project_id: PROJ, name: 'Sprint 1', start_date: t, end_date: new Date(Date.now() + 12096e5), ...A }]);
  await ins('work_items', [
    { _id: WI1, project_id: PROJ, sprint_id: SPRINT, source: 'taiga', external_id: 'TG-1', title: 'Login screen', description: 'Build login UI', type: 'story', status: 'in_progress', priority: 'high', assignee_id: U.dev1, story_points: 5, deleted_at: null, ...A },
    { _id: WI2, project_id: PROJ, sprint_id: SPRINT, source: 'taiga', external_id: 'TG-2', title: 'Fix crash on logout', description: 'NPE on logout', type: 'bug', status: 'todo', priority: 'medium', assignee_id: U.dev2, story_points: 3, deleted_at: null, ...A },
  ]);
  await ins('git_repositories', [{ _id: REPO, account_id: GACC, name: 'mobile-app', url: 'https://github.com/acme/mobile-app', visibility: 'private', ...A }]);
  await ins('ai_prompt_templates', [{ _id: oid(), model_id: AIMODEL, name: 'project_summary', prompt_text: 'Summarize project health for {{project}}', ...A }]);
  await ins('ai_conversation', [{ _id: AICONV, user_id: U.pm, title: 'Why is Mobile App at risk?', ...A }]);
  await ins('ai_chat_history', [{ _id: oid(), user_id: U.pm, model_id: AIMODEL, conversation_id: AICONV, messages: [{ role: 'user', content: 'Why is Mobile App at risk?', ts: t }], ...A }]);
  await ins('reports', [{ _id: REPORT, project_id: PROJ, name: 'Weekly Status', description: 'Auto weekly status', ...A }]);
  await ins('notifications', [{ _id: NOTIF, user_id: U.pm, type: 'risk_alert', payload: { project: 'Mobile App', level: 'HIGH' }, read_at: null, ...A }]);
  await ins('project_health', [{ _id: oid(), project_id: PROJ, score: 72, last_evaluated: t, calculation_version: 'v1', ...A }]);
  await ins('project_progress', [{ _id: oid(), project_id: PROJ, percent_complete: 45, last_updated: t, ...A }]);
  await ins('project_velocity', [{ _id: oid(), project_id: PROJ, sprint_id: SPRINT, points: 20, ...A }]);
  await ins('project_risk', [{ _id: oid(), project_id: PROJ, risk_type: 'schedule', severity: 'high', description: 'Behind on sprint scope', mitigated: false, ...A }]);
  await ins('project_prediction', [{ _id: oid(), project_id: PROJ, metric_name: 'completion_date', predicted_value: Date.now() + 7776e6, confidence: 78, ...A }]);
  await ins('developer_metrics', [{ _id: oid(), user_id: U.dev1, commits: 42, prs_merged: 8, code_reviews: 12, ...A }]);
  await ins('department_metrics', [{ _id: oid(), department_id: DEPT, commits: 120, prs_merged: 24, ...A }]);
  await ins('team_metrics', [{ _id: oid(), team_id: TEAM, commits: 90, prs_merged: 18, ...A }]);
  await ins('productivity_metrics', [{ _id: oid(), project_id: PROJ, sprint_id: SPRINT, velocity: 20, ...A }]);
  await ins('quality_metrics', [{ _id: oid(), project_id: PROJ, bug_count: 4, code_coverage: 63.5, ...A }]);
  await ins('bug_metrics', [{ _id: oid(), project_id: PROJ, severity: 'high', count: 2, ...A }]);
  await ins('audit_logs', [{ _id: oid(), entity_type: 'project', entity_id: PROJ, action: 'create', performed_by: U.admin, performed_at: t, details: { name: 'Mobile App' }, ...A }]);
  await ins('user_activity', [{ _id: oid(), user_id: U.pm, activity_type: 'view_dashboard', activity_data: { project: 'Mobile App' }, performed_at: t, ...A }]);
  await ins('api_logs', [{ _id: oid(), user_id: U.pm, endpoint: '/v1/projects', method: 'GET', status_code: 200, response_time_ms: 34, request_body: {}, response_body: {}, logged_at: t, ...A }]);
  await ins('scheduler_logs', [{ _id: oid(), job_name: 'analytics_calculation', status: 'success', started_at: t, finished_at: new Date(Date.now() + 1e4), details: {}, ...A }]);
  await ins('email_logs', [{ _id: oid(), email_id: EMAILQ, sent_at: t, status: 'sent', error_message: '', ...A }]);

  // ===================================================================== L3
  console.log('L3  third-level children');
  await ins('git_branches', [{ _id: BRANCH, repo_id: REPO, name: 'main', last_commit_sha: 'abc123', ...A }]);
  await ins('git_commits', [{ _id: COMMIT, repo_id: REPO, sha: 'abc123', author_id: U.dev1, message: 'feat: login screen', committed_at: t, ...A }]);
  await ins('git_pull_requests', [{ _id: PR, repo_id: REPO, number: 1, title: 'Login screen', state: 'open', merged_at: null, closed_at: null, ...A }]);
  await ins('git_tags', [{ _id: oid(), repo_id: REPO, name: 'v0.1.0', commit_sha: 'abc123', ...A }]);
  await ins('git_releases', [{ _id: RELEASE, repo_id: REPO, tag_name: 'v0.1.0', name: 'First preview', description: 'MVP preview', prerelease: true, ...A }]);
  await ins('git_webhooks', [{ _id: oid(), repo_id: REPO, url: 'https://aiproject.local/hooks/github', events: ['push', 'pull_request'], active: true, ...A }]);
  await ins('git_sync_history', [{ _id: oid(), repo_id: REPO, synced_at: t, status: 'success', message: 'Synced 1 commit, 1 PR', ...A }]);
  await ins('git_contributors', [{ _id: oid(), repo_id: REPO, user_id: U.dev1, commits: 42, added_lines: 1800, deleted_lines: 300, ...A }]);
  await ins('git_activity_snapshot', [{ _id: oid(), repo_id: REPO, snapshot_date: t, commit_count: 3, pr_count: 1, review_count: 1, ...A }]);
  await ins('git_merge_history', [{ _id: oid(), repo_id: REPO, source_branch: 'feature/login', target_branch: 'main', merged_at: t, ...A }]);
  await ins('taiga_projects', [{ _id: TPROJ, repo_id: REPO, name: 'mobile-app', description: 'Taiga board for mobile app', ...A }]);
  await ins('sprint_tasks', [
    { _id: oid(), sprint_id: SPRINT, work_item_id: WI1, ...A },
    { _id: oid(), sprint_id: SPRINT, work_item_id: WI2, ...A },
  ]);
  await ins('sprint_velocity', [{ _id: oid(), sprint_id: SPRINT, date: t, points_completed: 8, ...A }]);
  await ins('sprint_burndown', [{ _id: oid(), sprint_id: SPRINT, date: t, remaining_points: 12, ...A }]);
  await ins('sprint_burnup', [{ _id: oid(), sprint_id: SPRINT, date: t, total_points: 20, ...A }]);
  await ins('sprint_retrospective', [{ _id: oid(), sprint_id: SPRINT, notes: 'Scope crept mid-sprint', ...A }]);
  await ins('sprint_summary', [{ _id: oid(), sprint_id: SPRINT, velocity: 8, burndown_start: 20, burndown_end: 12, burnup_start: 0, burnup_end: 8, ...A }]);
  await ins('scheduled_reports', [{ _id: oid(), report_id: REPORT, cron_expression: '0 8 * * 1', next_run: new Date(Date.now() + 6048e5), ...A }]);
  await ins('report_history', [{ _id: RHIST, report_id: REPORT, run_at: t, status: 'success', output_path: '/reports/weekly-1.html', ...A }]);
  await ins('notification_history', [{ _id: oid(), notification_id: NOTIF, delivered_at: t, status: 'delivered', ...A }]);
  await ins('ai_reports', [{ _id: oid(), conversation_id: AICONV, report_text: 'Mobile App health is 72 and trending down...', ...A }]);
  await ins('ai_summary', [{ _id: oid(), conversation_id: AICONV, summary_text: 'Risk driven by blocked items and slipping velocity.', ...A }]);
  await ins('ai_recommendations', [{ _id: oid(), conversation_id: AICONV, recommendation_text: 'Reassign 2 blocked items; cut sprint scope by 20%.', ...A }]);
  await ins('ai_feedback', [{ _id: oid(), conversation_id: AICONV, rating: 4, comments: 'Useful summary', ...A }]);
  await ins('ai_prediction_logs', [{ _id: oid(), model_id: AIMODEL, input_text: 'velocity vector', output_text: 'delay 9d', confidence: 78, ...A }]);
  await ins('release_metrics', [{ _id: oid(), project_id: PROJ, release_id: RELEASE, deploy_time: 420, ...A }]);
  await ins('scheduler_history', [{ _id: oid(), job_id: SJOB, run_at: t, status: 'success', output: 'ok', ...A }]);
  await ins('scheduler_failures', [{ _id: oid(), job_id: SJOB, occurred_at: t, error_message: '(none - sample)', ...A }]);

  // ===================================================================== L4
  console.log('L4  fourth-level children');
  await ins('git_reviews', [{ _id: REVIEW, pr_id: PR, reviewer_id: U.pm, state: 'approved', ...A }]);
  await ins('git_file_changes', [{ _id: oid(), commit_id: COMMIT, file_path: 'src/screens/Login.tsx', added_lines: 120, deleted_lines: 4, ...A }]);
  await ins('taiga_epics', [{ _id: TEPIC, project_id: TPROJ, title: 'Authentication', description: 'All auth flows', status_id: TSTATUS, priority_id: TPRIO, severity_id: TSEV, ...A }]);
  await ins('taiga_issues', [{ _id: oid(), project_id: TPROJ, title: 'Logout crash', description: 'NPE', status_id: TSTATUS, priority_id: TPRIO, severity_id: TSEV, ...A }]);
  await ins('taiga_sprints', [{ _id: oid(), project_id: TPROJ, name: 'Milestone 1', start_date: t, end_date: new Date(Date.now() + 12096e5), ...A }]);
  await ins('taiga_members', [{ _id: oid(), project_id: TPROJ, user_id: U.dev1, role: 'developer', ...A }]);
  await ins('taiga_sync_history', [{ _id: oid(), project_id: TPROJ, synced_at: t, status: 'success', message: 'Synced 1 epic, 1 story, 1 task', ...A }]);
  await ins('report_export', [{ _id: REXPORT, history_id: RHIST, format: 'pdf', exported_at: t, file_path: '/reports/weekly-1.pdf', ...A }]);

  // ===================================================================== L5
  console.log('L5  fifth-level children');
  await ins('git_review_comments', [{ _id: oid(), review_id: REVIEW, author_id: U.pm, body: 'Looks good, ship it.', ...A }]);
  await ins('taiga_user_stories', [{ _id: TSTORY, epic_id: TEPIC, title: 'Login screen', description: 'User can log in', status_id: TSTATUS, priority_id: TPRIO, severity_id: TSEV, ...A }]);
  await ins('report_delivery', [{ _id: oid(), export_id: REXPORT, recipient_email: 'pm@aiproject.local', sent_at: t, status: 'sent', ...A }]);

  // ===================================================================== L6
  console.log('L6  sixth-level children');
  await ins('taiga_tasks', [{ _id: oid(), story_id: TSTORY, title: 'Wire login API', description: 'Call /auth/login', status_id: TSTATUS, priority_id: TPRIO, severity_id: TSEV, ...A }]);

  // eslint-disable-next-line no-console
  console.log(`\nseeded ${total} documents across ${(await db.listCollections().toArray()).length} collections into "${process.env.DB_NAME || 'ai_project'}"`);
  await mongoose.disconnect();
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
