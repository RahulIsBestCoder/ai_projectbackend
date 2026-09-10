import dotenv from 'dotenv';

dotenv.config();

import mongoose from 'mongoose';

/**
 * Simulated one-week sync feed.
 *
 * Generates ~7 days of realistic, fully cross-referenced activity for the demo
 * project — as if a GitHub + Taiga sync had run every day — across every
 * transactional collection: git objects, taiga backlog, normalized work_items,
 * sprint time-series, analytics/health/risk, snapshots, audit, notification and
 * the AI "why at risk" flow.
 *
 * Every generated document carries `seed_batch: "week"`. The script deletes that
 * batch first, so it is idempotent and never touches the demo / default seeds.
 *
 * Run: `npm run seed:week`
 */

// ---- deterministic RNG ----
let _s = 0x9e3779b9;
const rnd = (): number => {
  _s |= 0; _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
const sha = (): string => Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');

const oid = () => new mongoose.Types.ObjectId();
const DAY = 86400000;
const WEEK_END = new Date('2026-09-04T18:00:00.000Z');
const dayAt = (offsetFromStart: number): Date => new Date(WEEK_END.getTime() - (6 - offsetFromStart) * DAY);

async function run(): Promise<void> {
  const uri = `${process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/'}${process.env.DB_NAME || 'ai_project'}`;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db!;
  const BATCH = { seed_batch: 'week' };
  let total = 0;

  const ins = async (col: string, docs: Record<string, unknown>[]): Promise<void> => {
    if (!docs.length) return;
    await db.collection(col).insertMany(docs.map((d) => ({ ...d, ...BATCH })));
    total += docs.length;
    // eslint-disable-next-line no-console
    console.log(`  ${col.padEnd(24)} +${docs.length}`);
  };

  // wipe previous week batch across every collection that might hold it
  const allCols = (await db.listCollections().toArray()).map((c) => c.name);
  for (const c of allCols) await db.collection(c).deleteMany(BATCH);

  // ---------------------------------------------------------------- anchors
  const findOrMake = async (col: string, filter: Record<string, unknown>, make: Record<string, unknown>): Promise<any> => {
    const found = await db.collection(col).findOne(filter);
    if (found) return found;
    const doc = { _id: oid(), ...filter, ...make, created_at: WEEK_END, updated_at: WEEK_END };
    await db.collection(col).insertOne(doc);
    return doc;
  };

  const org = await findOrMake('organizations', { name: 'Acme Corp' }, { description: 'Demo organization', deleted_at: null });
  const project = await findOrMake('projects', { name: 'Mobile App', organization_id: org._id }, { description: 'Flagship mobile app', status: 'active', deleted_at: null });
  const dept = await findOrMake('departments', { name: 'Engineering', organization_id: org._id }, { description: 'Product engineering' });
  const team = await findOrMake('teams', { name: 'Platform Team', organization_id: org._id }, { description: 'Backend platform' });
  const gacc = await findOrMake('git_accounts', { organization_id: org._id, provider: 'github' }, { access_token: 'enc:gh', refresh_token: 'enc:ghr' });
  const repo = await findOrMake('git_repositories', { account_id: gacc._id, name: 'mobile-app' }, { url: 'https://github.com/acme/mobile-app', visibility: 'private' });
  const sprint = await findOrMake('sprints', { project_id: project._id, name: 'Sprint 1' }, { start_date: dayAt(0), end_date: new Date(WEEK_END.getTime() + 7 * DAY) });
  const tproj = await findOrMake('taiga_projects', { name: 'mobile-app' }, { repo_id: repo._id, description: 'Taiga board' });

  const mkUser = (name: string, email: string) => findOrMake('users', { email }, { full_name: name, password_hash: 'x', is_active: true, deleted_at: null });
  const pm = await mkUser('Priya Manager', 'pm@aiproject.local');
  const dev1 = await mkUser('Dev One', 'dev1@aiproject.local');
  const dev2 = await mkUser('Dev Two', 'dev2@aiproject.local');
  const dev3 = await mkUser('Dev Three', 'dev3@aiproject.local');
  const devs = [dev1, dev2, dev3];

  const tStatus = await findOrMake('taiga_status', { name: 'In progress' }, { description: 'In progress' });
  const tPrio = await findOrMake('taiga_priorities', { name: 'Normal' }, { description: 'Normal' });
  const tSev = await findOrMake('taiga_severity', { name: 'Normal' }, { description: 'Normal' });

  // ---------------------------------------------------------------- taiga backlog (once)
  const epics: any[] = [];
  for (const title of ['Authentication', 'Offline mode']) {
    const e = { _id: oid(), project_id: tproj._id, title, description: `${title} epic`, status_id: tStatus._id, priority_id: tPrio._id, severity_id: tSev._id, created_at: dayAt(0), updated_at: dayAt(0) };
    epics.push(e);
  }
  await ins('taiga_epics', epics);

  const storyTitles = ['Login screen', 'Token refresh', 'Biometric unlock', 'Sync queue', 'Conflict resolution', 'Session expiry banner'];
  const stories: any[] = storyTitles.map((title, i) => ({
    _id: oid(), epic_id: epics[i % 2]._id, title, description: `${title} story`,
    status_id: tStatus._id, priority_id: tPrio._id, severity_id: tSev._id,
    created_at: dayAt(int(0, 1)), updated_at: WEEK_END,
  }));
  await ins('taiga_user_stories', stories);

  const taskTitles = ['Wire login API', 'Form validation', 'Error toasts', 'Refresh interceptor', 'Keychain storage', 'Retry backoff', 'Merge strategy', 'E2E: happy path', 'Analytics events', 'Dark mode pass'];
  const tasks: any[] = taskTitles.map((title, i) => ({
    _id: oid(), story_id: stories[i % stories.length]._id, title, description: `${title}`,
    status_id: tStatus._id, priority_id: tPrio._id, severity_id: tSev._id,
    created_at: dayAt(int(0, 3)), updated_at: WEEK_END,
  }));
  await ins('taiga_tasks', tasks);

  const issues: any[] = ['Crash on logout', 'Token leak in logs', 'Slow cold start'].map((title) => ({
    _id: oid(), project_id: tproj._id, title, description: title,
    status_id: tStatus._id, priority_id: tPrio._id, severity_id: tSev._id,
    created_at: dayAt(int(1, 4)), updated_at: WEEK_END,
  }));
  await ins('taiga_issues', issues);

  await ins('taiga_sprints', [{ _id: oid(), project_id: tproj._id, name: 'Milestone 1', start_date: dayAt(0), end_date: new Date(WEEK_END.getTime() + 7 * DAY), created_at: dayAt(0), updated_at: WEEK_END }]);
  await ins('taiga_members', devs.concat(pm).map((u) => ({ _id: oid(), project_id: tproj._id, user_id: u._id, role: u._id.equals(pm._id) ? 'product owner' : 'developer', created_at: dayAt(0), updated_at: dayAt(0) })));

  // ---------------------------------------------------------------- normalized work_items
  const CANON_STATUS = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'];
  const CANON_TYPE = ['story', 'task', 'bug', 'subtask'];
  const CANON_PRIO = ['low', 'medium', 'high', 'urgent'];
  const workItems: any[] = [];
  const addWI = (src: any, type: string, extId: string) => {
    // status weighted toward done/in_progress by end of week
    const roll = rnd();
    const status = roll < 0.4 ? 'done' : roll < 0.7 ? 'in_progress' : roll < 0.85 ? 'todo' : roll < 0.95 ? 'blocked' : 'cancelled';
    workItems.push({
      _id: oid(), project_id: project._id, sprint_id: sprint._id,
      source: 'taiga', external_id: extId, title: src.title, description: src.description || src.title,
      type, status, priority: pick(CANON_PRIO),
      assignee_id: pick(devs)._id, story_points: pick([1, 2, 3, 5, 8]),
      deleted_at: null, created_at: src.created_at, updated_at: WEEK_END,
    });
  };
  stories.forEach((s, i) => addWI(s, 'story', `TG-S${i + 1}`));
  tasks.forEach((t, i) => addWI(t, 'task', `TG-T${i + 1}`));
  issues.forEach((s, i) => addWI(s, 'bug', `TG-I${i + 1}`));
  await ins('work_items', workItems);
  await ins('sprint_tasks', workItems.map((w) => ({ _id: oid(), sprint_id: sprint._id, work_item_id: w._id, created_at: w.created_at, updated_at: w.created_at })));

  const totalPoints = workItems.reduce((s, w) => s + w.story_points, 0);

  // ---------------------------------------------------------------- per-day git + snapshots
  const commits: any[] = [];
  const fileChanges: any[] = [];
  const prs: any[] = [];
  const reviews: any[] = [];
  const reviewComments: any[] = [];
  const merges: any[] = [];
  const branches: any[] = [{ _id: oid(), repo_id: repo._id, name: 'main', last_commit_sha: sha(), created_at: dayAt(0), updated_at: WEEK_END }];
  const gitDaily: any[] = [];
  const gitSync: any[] = [];
  const taigaSync: any[] = [];
  const dailySnap: any[] = [];
  const histSnap: any[] = [];
  const velocity: any[] = [];
  const burndown: any[] = [];
  const burnup: any[] = [];
  const healthRows: any[] = [];
  const progressRows: any[] = [];
  const auditRows: any[] = [];

  const commitMsgs = ['feat: login screen', 'fix: null guard on logout', 'refactor: auth service', 'test: token refresh', 'chore: bump deps', 'feat: keychain storage', 'fix: retry backoff', 'perf: cold start', 'feat: dark mode', 'docs: sync notes'];
  const prTitles = ['Login screen', 'Token refresh interceptor', 'Keychain storage', 'Offline sync queue', 'Dark mode pass'];
  let prNo = 100;
  let remaining = totalPoints;
  let completedPts = 0;
  let health = 74;

  for (let d = 0; d < 7; d += 1) {
    const date = dayAt(d);
    const nCommits = int(2, 6);
    let dayCommits = 0;
    for (let c = 0; c < nCommits; c += 1) {
      const author = pick(devs);
      const s = sha();
      commits.push({ _id: oid(), repo_id: repo._id, sha: s, author_id: author._id, message: pick(commitMsgs), committed_at: new Date(date.getTime() + c * 3600e3), created_at: date, updated_at: date });
      dayCommits += 1;
      const nf = int(1, 3);
      for (let f = 0; f < nf; f += 1) {
        fileChanges.push({ _id: oid(), commit_id: commits[commits.length - 1]._id, file_path: pick(['src/auth/login.ts', 'src/auth/token.ts', 'src/sync/queue.ts', 'src/ui/Theme.tsx', 'test/auth.spec.ts']), added_lines: int(3, 120), deleted_lines: int(0, 40), created_at: date, updated_at: date });
      }
    }

    // a PR roughly every other day
    let dayPRs = 0;
    let dayReviews = 0;
    if (d % 2 === 0) {
      prNo += 1;
      const opened = new Date(date.getTime() + 4 * 3600e3);
      const willMerge = rnd() < 0.7 && d < 6;
      const mergedAt = willMerge ? new Date(opened.getTime() + int(1, 2) * DAY) : null;
      const pr = { _id: oid(), repo_id: repo._id, number: prNo, title: pick(prTitles), state: mergedAt ? 'merged' : 'open', merged_at: mergedAt, closed_at: mergedAt, created_at: opened, updated_at: mergedAt || opened };
      prs.push(pr);
      dayPRs = 1;
      const rev = { _id: oid(), pr_id: pr._id, reviewer_id: pm._id, state: mergedAt ? 'approved' : 'commented', created_at: new Date(opened.getTime() + 6 * 3600e3), updated_at: opened };
      reviews.push(rev);
      dayReviews = 1;
      reviewComments.push({ _id: oid(), review_id: rev._id, author_id: pm._id, body: pick(['LGTM', 'nit: rename var', 'add a test for the error path', 'ship it']), created_at: rev.created_at, updated_at: rev.created_at });
      const fb = `feature/${pick(['login', 'token', 'keychain', 'sync', 'theme'])}-${prNo}`;
      branches.push({ _id: oid(), repo_id: repo._id, name: fb, last_commit_sha: sha(), created_at: opened, updated_at: opened });
      if (mergedAt) merges.push({ _id: oid(), repo_id: repo._id, source_branch: fb, target_branch: 'main', merged_at: mergedAt, created_at: mergedAt, updated_at: mergedAt });
    }

    gitDaily.push({ _id: oid(), repo_id: repo._id, snapshot_date: date, commit_count: dayCommits, pr_count: dayPRs, review_count: dayReviews, created_at: date, updated_at: date });
    gitSync.push({ _id: oid(), repo_id: repo._id, synced_at: new Date(date.getTime() + 23 * 3600e3), status: 'success', message: `synced ${dayCommits} commits, ${dayPRs} PR(s)`, created_at: date, updated_at: date });
    taigaSync.push({ _id: oid(), project_id: tproj._id, synced_at: new Date(date.getTime() + 23 * 3600e3), status: d === 3 ? 'partial' : 'success', message: d === 3 ? 'rate-limited, 2 items deferred' : 'ok', created_at: date, updated_at: date });

    // sprint burn time-series
    const done = int(2, 6);
    completedPts += done;
    remaining = Math.max(0, totalPoints - completedPts);
    velocity.push({ _id: oid(), sprint_id: sprint._id, date, points_completed: done, created_at: date, updated_at: date });
    burndown.push({ _id: oid(), sprint_id: sprint._id, date, remaining_points: remaining, created_at: date, updated_at: date });
    burnup.push({ _id: oid(), sprint_id: sprint._id, date, total_points: totalPoints, created_at: date, updated_at: date });

    // health drifts down mid-week (partial sync + blocked items) then recovers
    health += d === 2 ? -4 : d === 3 ? -3 : d >= 5 ? 3 : int(-1, 1);
    health = Math.max(40, Math.min(95, health));
    const progressPct = Math.round((completedPts / totalPoints) * 100);
    healthRows.push({ _id: oid(), project_id: project._id, score: health, last_evaluated: date, calculation_version: process.env.HEALTH_CALC_VERSION || 'v1', evaluation_strategy: 'ratio_default', created_at: date, updated_at: date });
    progressRows.push({ _id: oid(), project_id: project._id, percent_complete: progressPct, last_updated: date, created_at: date, updated_at: date });

    dailySnap.push({ _id: oid(), entity_type: 'project', entity_id: project._id, snapshot_date: date, data: { health, progress: progressPct, remaining_points: remaining, velocity: done }, created_at: date, updated_at: date });
    histSnap.push({ _id: oid(), entity_type: 'project', entity_id: project._id, snapshot_date: date, data: { health, progress: progressPct }, created_at: date, updated_at: date });
    auditRows.push({ _id: oid(), entity_type: 'integration', entity_id: repo._id, action: 'sync', performed_by: null, performed_at: new Date(date.getTime() + 23 * 3600e3), details: { provider: 'github', commits: dayCommits, prs: dayPRs }, created_at: date, updated_at: date });
  }

  await ins('git_branches', branches);
  await ins('git_commits', commits);
  await ins('git_file_changes', fileChanges);
  await ins('git_pull_requests', prs);
  await ins('git_reviews', reviews);
  await ins('git_review_comments', reviewComments);
  await ins('git_merge_history', merges);
  await ins('git_activity_snapshot', gitDaily);
  await ins('git_sync_history', gitSync);
  await ins('taiga_sync_history', taigaSync);
  await ins('sprint_velocity', velocity);
  await ins('sprint_burndown', burndown);
  await ins('sprint_burnup', burnup);
  await ins('project_health', healthRows);
  await ins('project_progress', progressRows);
  await ins('daily_snapshots', dailySnap);
  await ins('historical_snapshots', histSnap);
  await ins('audit_logs', auditRows);

  // ---------------------------------------------------------------- release mid-week
  const relDate = dayAt(4);
  await ins('git_tags', [{ _id: oid(), repo_id: repo._id, name: 'v0.2.0', commit_sha: commits[Math.floor(commits.length / 2)].sha, created_at: relDate, updated_at: relDate }]);
  const release = { _id: oid(), repo_id: repo._id, tag_name: 'v0.2.0', name: 'Week preview', description: 'Auth + sync queue', prerelease: true, created_at: relDate, updated_at: relDate };
  await ins('git_releases', [release]);
  await ins('release_metrics', [{ _id: oid(), project_id: project._id, release_id: release._id, deploy_time: int(180, 600), created_at: relDate, updated_at: relDate }]);
  await ins('git_webhooks', [{ _id: oid(), repo_id: repo._id, url: process.env.WEBHOOK_CALLBACK_URL || 'http://localhost:3000/v1/integrations/webhook', events: ['push', 'pull_request'], active: true, created_at: dayAt(0), updated_at: dayAt(0) }]);

  // ---------------------------------------------------------------- weekly aggregates
  const commitsByUser = (uid: any) => commits.filter((c) => c.author_id.equals(uid)).length;
  const linesByUser = (uid: any) => fileChanges.filter((f) => commits.find((c) => c._id.equals(f.commit_id) && c.author_id.equals(uid)));
  await ins('git_contributors', devs.map((u) => {
    const lf = linesByUser(u._id);
    return { _id: oid(), repo_id: repo._id, user_id: u._id, commits: commitsByUser(u._id), added_lines: lf.reduce((s, f) => s + f.added_lines, 0), deleted_lines: lf.reduce((s, f) => s + f.deleted_lines, 0), created_at: WEEK_END, updated_at: WEEK_END };
  }));
  await ins('developer_metrics', devs.map((u) => ({
    _id: oid(), user_id: u._id, commits: commitsByUser(u._id),
    prs_merged: merges.length ? int(1, Math.max(1, merges.length)) : 0,
    code_reviews: reviews.filter((r) => r.reviewer_id.equals(u._id)).length,
    created_at: WEEK_END, updated_at: WEEK_END,
  })));
  await ins('department_metrics', [{ _id: oid(), department_id: dept._id, commits: commits.length, prs_merged: merges.length, created_at: WEEK_END, updated_at: WEEK_END }]);
  await ins('team_metrics', [{ _id: oid(), team_id: team._id, commits: commits.length, prs_merged: merges.length, created_at: WEEK_END, updated_at: WEEK_END }]);
  await ins('project_velocity', [{ _id: oid(), project_id: project._id, sprint_id: sprint._id, points: completedPts, created_at: WEEK_END, updated_at: WEEK_END }]);
  await ins('productivity_metrics', [{ _id: oid(), project_id: project._id, sprint_id: sprint._id, velocity: completedPts, created_at: WEEK_END, updated_at: WEEK_END }]);
  await ins('quality_metrics', [{ _id: oid(), project_id: project._id, bug_count: workItems.filter((w) => w.type === 'bug').length, code_coverage: 55 + int(0, 15), created_at: WEEK_END, updated_at: WEEK_END }]);
  await ins('bug_metrics', [
    { _id: oid(), project_id: project._id, severity: 'high', count: 2, created_at: WEEK_END, updated_at: WEEK_END },
    { _id: oid(), project_id: project._id, severity: 'medium', count: 3, created_at: WEEK_END, updated_at: WEEK_END },
  ]);
  await ins('project_risk', [
    { _id: oid(), project_id: project._id, risk_type: 'schedule', severity: 'high', description: 'Blocked items + partial Taiga sync mid-week', mitigated: false, created_at: dayAt(3), updated_at: WEEK_END },
    { _id: oid(), project_id: project._id, risk_type: 'quality', severity: 'medium', description: 'Coverage below 60%', mitigated: false, created_at: dayAt(4), updated_at: WEEK_END },
  ]);
  const predDate = new Date(WEEK_END.getTime() + int(8, 16) * DAY);
  await ins('project_prediction', [{ _id: oid(), project_id: project._id, metric_name: 'completion_date', predicted_value: predDate.getTime(), confidence: 72, created_at: WEEK_END, updated_at: WEEK_END }]);
  await ins('weekly_snapshots', [{ _id: oid(), entity_type: 'project', entity_id: project._id, week_start: dayAt(0), data: { health_end: health, velocity: completedPts, prs_merged: merges.length, commits: commits.length, progress: Math.round((completedPts / totalPoints) * 100) }, created_at: WEEK_END, updated_at: WEEK_END }]);
  await ins('sprint_summary', [{ _id: oid(), sprint_id: sprint._id, velocity: completedPts, burndown_start: totalPoints, burndown_end: remaining, burnup_start: 0, burnup_end: completedPts, created_at: WEEK_END, updated_at: WEEK_END }]);
  await ins('sprint_retrospective', [{ _id: oid(), sprint_id: sprint._id, notes: 'Partial Taiga sync on day 4 hid two blocked items; caught up by day 6.', created_at: WEEK_END, updated_at: WEEK_END }]);

  // ---------------------------------------------------------------- notification + AI flow
  await ins('notifications', [{ _id: oid(), user_id: pm._id, type: 'risk_alert', payload: { project: 'Mobile App', level: 'HIGH', driver: 'blocked items + coverage' }, read_at: null, created_at: dayAt(3), updated_at: dayAt(3) }]);
  await ins('notification_history', []);
  const convo = { _id: oid(), user_id: pm._id, title: 'Why did Mobile App health drop this week?', created_at: dayAt(4), updated_at: dayAt(4) };
  await ins('ai_conversation', [convo]);
  const aiModel = await db.collection('ai_models').findOne({ name: 'claude-sonnet-5' });
  await ins('ai_chat_history', [{ _id: oid(), user_id: pm._id, model_id: aiModel?._id || oid(), conversation_id: convo._id, messages: [{ role: 'user', content: 'Why did Mobile App health drop this week?', ts: dayAt(4) }, { role: 'assistant', content: 'Health fell from 74 to a mid-week low after a partial Taiga sync on day 4 masked two blocked items; velocity held but coverage stayed under 60%.', ts: dayAt(4) }], created_at: dayAt(4), updated_at: dayAt(4) }]);
  await ins('ai_summary', [{ _id: oid(), conversation_id: convo._id, summary_text: 'Mid-week dip driven by blocked work items + sub-60% coverage; recovering by day 6.', created_at: dayAt(4), updated_at: dayAt(4) }]);
  await ins('ai_recommendations', [{ _id: oid(), conversation_id: convo._id, recommendation_text: '1) Unblock the 2 blocked items. 2) Add tests to lift coverage above 60%. 3) Alert on partial syncs.', created_at: dayAt(4), updated_at: dayAt(4) }]);
  await ins('ai_reports', [{ _id: oid(), conversation_id: convo._id, report_text: 'Weekly: 7 sync days, ' + commits.length + ' commits, ' + merges.length + ' merges to main, velocity ' + completedPts + ' pts, health ' + health + '.', created_at: WEEK_END, updated_at: WEEK_END }]);

  // eslint-disable-next-line no-console
  console.log(`\nweek sync feed seeded — ${total} documents (batch "week", ${WEEK_END.toISOString().slice(0, 10)} minus 6 days).`);
  await mongoose.disconnect();
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
