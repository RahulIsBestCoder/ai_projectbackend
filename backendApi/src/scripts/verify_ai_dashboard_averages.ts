/** Regression check for unfinished-project portfolio averages. */
const assert = require('node:assert/strict');
const { toDashboardCard, sumDashboardCards } = require('../domain/project/service/ai_dashboard_mapper');

const report = (complete: number, health: number, probability: number, tasks: number, date: string) => ({
  _id: `report-${complete}`,
  generated_at: '2026-09-21T00:00:00.000Z',
  report_data: {
    planAndActual: { completePercent: complete },
    workBreakdown: { totalTasks: tasks, completed: Math.round(tasks * complete / 100), byFeature: [] },
    healthAndTrend: { healthScore: health, overallHealth: 'healthy' },
    risksAndPredictions: { predictions: { deadlineProbability: probability, expectedCompletionDate: date } },
  },
});

const cards = [
  toDashboardCard({ _id: 'a', name: 'Small active', status: 1 }, report(20, 40, 0.4, 2, '2026-10-01')),
  toDashboardCard({ _id: 'b', name: 'Large active', status: 2 }, report(80, 80, 0.8, 100, '2026-11-01')),
  toDashboardCard({ _id: 'c', name: 'Achieved by progress', status: 1 }, report(100, 100, 1, 20, '2026-09-01')),
  toDashboardCard({ _id: 'd', name: 'Completed status', status: 3 }, report(10, 10, 0.1, 10, '2026-12-01')),
  toDashboardCard({ _id: 'e', name: 'Missing active report', status: 1 }, undefined),
  toDashboardCard({ _id: 'f', name: 'Archived', status: 4 }, undefined),
];
const totals = sumDashboardCards(cards);
const sprintOnly = toDashboardCard({ _id: 'g', name: 'Sprint must not drive dashboard', status: 1 }, {
  ...report(17, 30, 0.2, 6, '2026-12-20'),
  report_data: { ...report(17, 30, 0.2, 6, '2026-12-20').report_data, report: { type: 'sprint_review' } },
});
assert.equal(sprintOnly.implementation, null);
assert.equal(totals.reports.total_projects, 3);
assert.equal(totals.reports.with_report, 2);
assert.equal(totals.reports.missing, 1);
assert.equal(totals.implementation.complete_percent, 50); // project average, not task weighted
assert.equal(totals.health.avg_score, 60);
assert.equal(totals.forecast.avg_deadline_probability, 0.6);
assert.match(totals.forecast.latest_expected_completion_date, /^2026-11-01/);
assert.equal(totals.implementation.tasks.total, 102);
console.log('PASS: dashboard averages include only unfinished projects and weight each project equally');
