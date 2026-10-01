import assert from 'node:assert/strict';
import { reportWindow, ratePerWeek, featureProgress, titlesMatch, sprintsMatch } from '../domain/reporting/service/report_metrics';
import { reportChart } from '../domain/reporting/service/report_chart';
import { ReportingService } from '../domain/reporting/service/reporting_service';
import { AiIntelligenceService } from '../domain/ai_intelligence/service/ai_intelligence_service';

async function main() {
  const window = reportWindow(new Date('2026-10-20T12:00:00Z'), '2026-10-01', '2026-10-14');
  assert.equal(window.until.toISOString(), '2026-10-15T00:00:00.000Z');
  assert.equal(window.days, 14);
  assert.equal(ratePerWeek(28, window.days), 14);
  assert.equal(reportWindow(new Date('2026-10-20'), '2026-11-01', '2026-11-14').days, 0);
  assert.equal(ratePerWeek(0, 0), null);
  assert.deepEqual(featureProgress({ plan: 100, taiga: 100, repository: 100 }), { progress: 100, status: 'implemented' });
  assert.equal(featureProgress({ plan: 100, taiga: 0, repository: 0 }).progress, 35);
  assert.equal(featureProgress({ plan: 100, taiga: 100, repository: 0 }).progress, 70);
  assert.equal(featureProgress({ plan: 100, taiga: 50, repository: 50 }).progress, 67.5);
  assert.deepEqual(featureProgress({ plan: null, taiga: null, repository: null }), { progress: 0, status: 'not_implemented' });
  assert.ok(sprintsMatch({ title: 'Sprint 1' }, { name: 'sprint-1' }));
  assert.ok(!sprintsMatch({ title: 'Sprint 1' }, { name: 'Sprint 10' }));
  assert.ok(sprintsMatch({ title: 'Plan S2', meta: { start_date: '2026-10-01', end_date: '2026-10-14' } }, { name: 'Taiga X', start_date: '2026-10-02', end_date: '2026-10-15' }));
  assert.ok(titlesMatch('Secure authentication, OTP and multilingual support', 'Secure authentication, OTP and multilingual sup...'));
  assert.ok(!titlesMatch('Mobile app UI', 'Admin UI components'));
  assert.ok(titlesMatch('Authentication Service', 'Authentication: Login, Logout, JWT, OTP, Forgot Password'));
  assert.ok(!titlesMatch('User Login', 'User Profile'));
  assert.ok(!titlesMatch('Sprint 1 additional task 2', 'Sprint 1 additional task 1'));
  assert.ok(!titlesMatch('Banners CRUD & publishing workflow', 'FAQ: CRUD'));
  assert.ok(titlesMatch('Banners CRUD & publishing workflow', 'Banners: Draft, Images, Publish'));
  assert.ok(!titlesMatch('Customer profile CRUD', 'Banners: Draft, Images, Publish, Admin/Customer Details'));
  assert.ok(titlesMatch('Place Order endpoint', 'Orders: Place, List, Details, Update, Status'));
  const pie = reportChart({ type: 'pie', labels: ['Merged', 'Open'], datasets: [{ label: 'PRs', data: [2, 6] }] });
  assert.match(pie, /stroke-dasharray="25 75"/);
  assert.match(pie, /8 total/);
  const multi = reportChart({ type: 'line', labels: ['Week 1', 'Week 2', 'Week 3'], datasets: [{ label: 'Commits', data: [1, null, 3] }, { label: 'PRs', data: [2, 4, 6] }] });
  assert.match(multi, /Not available/); assert.match(multi, /Commits/); assert.match(multi, /PRs/);
  assert.equal((multi.match(/stroke="#4f46e5" stroke-width="2"/g) || []).length, 0, 'No line across missing values');
  assert.ok(!reportChart({ type: 'bar', labels: ['<script>'], datasets: [{ label: 'x', data: [1] }] }).includes('<script>'));

  (global as any).Helpers = { makeBadServiceStatus: (message: string) => ({ status: false, message }), makeSuccessServiceStatus: (_: string, data: any) => ({ status: true, data_sets: data }) };
  const service: any = Object.create(ReportingService.prototype);
  service.initLog = () => {}; service.log = () => {};
  const updates: any[] = [];
  let filter: any;
  service._reportModel = {
    findByAny: async (query: any) => { filter = query; return null; },
    addNewRecord: async (row: any) => { updates.push(row); return { _id: 'report' }; },
    updateAnyRecord: async (_: any, row: any) => { updates.push(row); },
  };
  service._ai = { generateReport: async () => { throw new Error('Mock failure'); } };
  const failed = await service.createReport({ project_id: 'project', name: 'Report', report_type: 'sprint', sprint_id: 'sprint-2' });
  assert.equal(failed.status, false);
  assert.equal(filter.is_deleted, false);
  assert.equal(filter['definition.sprint_id'], 'sprint-2');
  assert.deepEqual(updates.map(u => u.status), ['generating', 'failed']);
  service._ai.generateReport = async () => ({ report: { generatedBy: 'ai', generatedAt: new Date().toISOString() } });
  assert.equal((await service.createReport({ project_id: 'project', name: 'Report' })).status, true);
  assert.equal(updates.at(-1).status, 'generated');

  const ai: any = Object.create(AiIntelligenceService.prototype);
  ai.initLog = () => {}; ai.log = () => {};
  ai._generate = async () => JSON.stringify({ executive_summary: 'Snapshot', feature_assessment: [], findings: [], recommendations: [] });
  ai._insightModel = { addNewRecord: async () => ({}) };
  ai._planModel = { findAllByAny: async () => [] };
  ai.analyzeImplementation = async () => ({ available: false });
  let workforceCalls = 0;
  ai._departmentWorkforce = async () => { workforceCalls++; return { departments: [] }; };
  ai._assembleProjectFacts = async () => ({ sources: [], facts: { base: { project: { name: 'Test' }, analytics: { velocity: 999, metrics: [] }, risks: {} },
    work_items: { total: 2, done_percent: 50, by_status: { closed: { count: 1 }, new: { count: 1 } } }, sprints: {}, plan: {} } });
  const sprint = { name: 'Sprint', start_date: '2026-01-01', end_date: '2026-01-14', taiga_milestone_id: 1, completed_points: 3 };
  const tasks = [{ assigned_to_id: 'a', assigned_to_username: 'dev', taiga_milestone_id: 1, is_closed: true, status_name: 'Released' },
    { assigned_to_id: 'b', assigned_to_username: 'other', taiga_milestone_id: 2, is_closed: false }];
  (global as any).db = { connection: { db: { collection: (name: string) => ({
    findOne: async () => name === 'sprints' ? sprint : null,
    find: (query: any) => {
      let rows: any[] = name === 'taiga_tasks' ? tasks : name === 'sprints' ? [sprint] : [];
      if (name === 'commits') {
        if (query.committed_at.$gte.toISOString().startsWith('2026-01-01')) {
          assert.equal(query.committed_at.$lt.toISOString(), '2026-01-15T00:00:00.000Z');
          rows = [{ committed_at: new Date('2026-01-14T23:59:00Z'), author_name: 'dev', additions: 2, deletions: 1 }];
        }
      }
      const cursor: any = { project: () => cursor, sort: () => cursor, toArray: async () => rows };
      return cursor;
    },
  }) } } };
  const sprintReport = await ai.generateReport('project', { report_type: 'sprint', sprint_id: '1' });
  assert.equal(sprintReport.executiveSummary.totalTasks, 1);
  assert.equal(sprintReport.executiveSummary.completedTasks, 1);
  assert.equal(sprintReport.velocityAndSprint.velocity, 3);
  assert.equal(sprintReport.gitActivity.window_days, 14);
  assert.equal(sprintReport.gitActivity.commit_rate_per_week, 0.5);
  assert.equal(sprintReport.departmentWorkforce, null);
  assert.equal(workforceCalls, 0);
  const whole = await ai.generateReport('project', { report_type: 'project' });
  assert.equal(whole.executiveSummary.totalTasks, 2);
  assert.equal(whole.velocityAndSprint.velocity, 999);
  assert.equal(workforceCalls, 1);
  assert.equal(whole.gitActivity.window_days, 84);
  console.log('PASS: separate sprint/project scope, final-day activity, weekly rates, lifecycle failures, deleted filters, chart proportions and all datasets.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
