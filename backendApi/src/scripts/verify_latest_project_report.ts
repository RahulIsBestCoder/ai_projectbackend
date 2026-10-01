import assert from 'node:assert/strict';
import { AiIntelligenceService } from '../domain/ai_intelligence/service/ai_intelligence_service';

const cursor = (rows: any[]) => ({ project() { return this; }, sort() { return this; }, toArray: async () => rows });
async function main() {
  const service: any = Object.create(AiIntelligenceService.prototype);
  service.initLog = () => {};
  service.log = () => {};
  service._assembleProjectFacts = async () => ({ facts: {
    base: { project: { name: 'Nova', status: 'active' }, analytics: {}, risks: { risk_level: 'MEDIUM' }, blockers: [] },
    sprints: { total: 2 }, work_items: { total: 10, done_percent: 40 },
    plan: { title: 'Launch plan', status: 'accepted' }, plan_execution: { percent: 50 },
    code: { coverage: { incomplete: false }, repositories: [] },
  }, sources: ['project', 'analytics', 'risks', 'sprints', 'work_items', 'plans', 'plan_execution', 'github_source_files'] });
  service._planModel = { findAllByAny: async () => [{ updated_at: new Date(), input: { start_date: '2026-01-01' },
    plan: { deadlines: [{ date: '2026-12-31' }] } }] };
  service.analyzeImplementation = async () => ({ progressPercent: 60, unclearItems: 0, coverage: { incomplete: false }, items: [] });
  const layers: string[] = [];
  let layer2Prompt = '';
  service._generate = async (prompt: string, endpoint: string) => {
    layers.push(endpoint);
    if (endpoint === 'report_evidence') return JSON.stringify({ evidence_summary: 'Repository inspected.', findings: [],
      feature_assessment: [{ feature: 'Auth', status: 'implemented', evidence: ['org/repo/main/src/auth.ts'] }],
      data_quality: { confidence_percent: 80, limitations: [] } });
    layer2Prompt = prompt;
    return JSON.stringify({ executive_summary: 'Evidence-based status.', status: 'at_risk',
      findings: [{ title: 'Gap', detail: 'Execution trails implementation.', severity: 'medium', evidence: ['org/repo/main/src/a.ts'] }],
      feature_assessment: [{ feature: 'Auth', status: 'implemented', evidence: ['org/repo/main/src/auth.ts'] }],
      recommendations: [{ action: 'Close gap', priority: 'high', expected_impact: 'Improve delivery', owner: 'PM', due_date: null }], confidence_percent: 82 });
  };
  service._insightModel = { addNewRecord: async () => ({}) };
  (global as any).db = { connection: { db: { collection: (name: string) => ({
    find: () => cursor(name === 'github_repositories' ? [{ repositoryFullName: 'org/repo', syncStatus: 'success' }]
      : name === 'commits' ? [{ committed_at: new Date(), additions: 10, deletions: 2, author_name: 'Git Developer', author_email: 'git@example.com' }]
      : name === 'pull_requests' ? [{ created_at: new Date(), status: 'merged', merged_at: new Date() }]
      : name === 'taiga_tasks' ? [{ assigned_to_username: 'taiga-dev', assigned_to_full_name: 'Taiga Developer', type: 'bug', is_closed: true,
        taiga_task_id: 11, taiga_milestone_id: 1, taiga_milestone_slug: 'Sprint 1', status_name: 'Closed' }]
      : name === 'sprints' ? [{ _id: 'sprint-1', name: 'Sprint 1', taiga_milestone_id: 1, start_date: '2026-01-01', end_date: '2026-12-31', planned_points: 8, completed_points: 8 }] : []),
    findOne: async () => name === 'sprints' ? { _id: 'sprint-1', project_id: 'p', name: 'Sprint 1', taiga_milestone_id: 1,
      start_date: '2026-01-01', end_date: '2026-12-31', planned_points: 8, completed_points: 8 } : null,
  }) } } };
  const report = await service.generateReport('p', { content: 'Latest whole project report' });
  assert.equal(report.report.schemaVersion, 'project-report.v1');
  assert.equal(report.report.type, 'latest_project_review');
  assert.equal(report.report.repositoryCount, 1);
  assert.equal(report.executiveSummary.overallProgress, 50);
  assert.equal(report.executiveSummary.remainingProgress, 50);
  assert.equal(report.planAndActual.calculationBasis, 'plan_execution_checklist');
  assert.equal(report.gitActivity.merge_rate_percent, 100);
  assert.equal(report.gitActivity.commit_rate_per_week, 0.1);
  assert.equal(report.risksAndPredictions.predictions.deadlineProbability >= 0, true);
  assert.equal(report.workBreakdown.byFeature[0].featureName, 'Auth');
  assert.equal(report.employeeWorking.totals.employees, 2);
  assert.equal(report.taigaSprintSummary.totalTasks, 1);
  assert.equal(report.taigaSprintSummary.rows[0].sprintName, 'Sprint 1');
  assert.equal(report.employeeWorking.totals.gitCommits, 1);
  assert.equal(report.employeeWorking.totals.taigaBugsSolved, 1);
  assert.equal(report.employeeWorking.departments[0].department, 'Unassigned');
  assert.equal(report.deliveryForecast.repositoryCoverage.combinedAnalysis, true);
  assert.equal(report.deliveryForecast.remainingWorkPercent, 50);
  assert.ok(report.deliveryForecast.predictedCompletionDate);
  assert.deepEqual(report.visualData.map((chart: any) => chart.type), ['pie', 'bar', 'line', 'pie', 'bar', 'pie']);
  assert.match(report.aiNarrative.summary, /Evidence-based/);
  assert.deepEqual(layers, ['report_evidence', 'report_json']);
  assert.match(layer2Prompt, /Repository inspected/);
  const sprintReport = await service.generateReport('p', { report_type: 'sprint', sprint_id: 'sprint-1', content: 'Sprint report' });
  assert.equal(sprintReport.report.type, 'sprint_review');
  assert.equal(sprintReport.report.sprint.name, 'Sprint 1');
  assert.equal(sprintReport.report.period.type, 'sprint');
  assert.equal(sprintReport.executiveSummary.totalTasks, 1);
  assert.equal(sprintReport.executiveSummary.overallProgress, 100);
  assert.equal(sprintReport.taigaSprintSummary.rows.length, 1);
  assert.equal(sprintReport.taigaSprintSummary.rows[0].sprintName, 'Sprint 1');
  console.log('PASS: latest whole-project report schema, progress, deadline, Git rates, feature evidence, and visuals.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
