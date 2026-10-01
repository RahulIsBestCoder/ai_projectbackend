import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import path from 'path';
import { ReportPdfService } from '../domain/reporting/service/report_pdf_service';
import { buildTaigaSprintSummary } from '../domain/reporting/service/taiga_sprint_summary';

async function main() {
  (global as any).path = path.resolve(__dirname, '..');
  const prepared = await new ReportPdfService().prepare({
    name: 'Nova Platform Report',
    report_data: {
      report: { title: 'Nova Platform - Latest Project Report', project: { name: 'Nova Platform' }, generatedAt: new Date().toISOString() },
      executiveSummary: { summary: 'PDF verification report.', overallProgress: 60, remainingProgress: 40 },
      taigaSprintSummary: buildTaigaSprintSummary([
        { taiga_task_id: 1, taiga_milestone_id: 1, status_name: 'Ready for QA', is_blocked: true },
        { taiga_task_id: 2, taiga_milestone_id: 1, status_name: 'Closed', is_closed: true },
        { taiga_task_id: 3, status_name: 'New' },
      ], [{ taiga_milestone_id: 1, name: 'Sprint 1 - Payment integration' },
          { taiga_milestone_id: 2, name: 'Sprint 2 - Customer experience and localization' }]),
      healthAndTrend: { overallHealth: 'healthy', healthScore: 80, trend: 'improving' },
      velocityAndSprint: { sprintName: 'Sprint 1', plannedPoints: 10, completedPoints: 6, completionRate: 60 },
      workBreakdown: { totalTasks: 10, completed: 6, inProgress: 3, blocked: 1, notStarted: 0, byFeature: [] },
      employeeWorking: { departments: [{ departmentId: 'eng', department: 'Engineering', gitCommits: 5, taigaBugsAssigned: 3, taigaBugsSolved: 2,
        employees: [{ employeeId: 'u1', name: 'Nova Dev', email: 'dev@nova.test', designation: 'Software Engineer', departmentId: 'eng', department: 'Engineering', gitCommits: 5, gitAdditions: 120, gitDeletions: 20, taigaBugsAssigned: 3, taigaBugsSolved: 2, activityScore: 72, activityRating: 'Strong', ratingBasis: 'COMMITS_CODE_CHANGES_AND_TAIGA_COMPLETION' }] }],
        totals: { employees: 1, gitCommits: 5, taigaBugsAssigned: 3, taigaBugsSolved: 2 } },
      departmentWorkforce: {
        organization_id: '6aa25d1cb8cdc6b232abe540', active_window_days: 30, source: 'commits_by_repository_category',
        total_employees: 3, unlinked_repository_count: 1,
        departments: [
          { id: 'ui', name: 'UI Team', color: '#8b5cf6', description: 'Frontend / UI team repository',
            member_count: 2, active_count: 1, commit_count: 51, additions: 118800, deletions: 36589, teams: ['MGROC-GROCERY/admin_angular_v2'],
            repositories: [{ id: 'repo-ui', name: 'MGROC-GROCERY/admin_angular_v2', linked: true, project_name: 'Nova Platform' }],
            tasks: null, efficiency: null,
            employees: [{ id: 'login:amitmarjit-mass', name: 'amitmarjit-mass', login: 'amitmarjit-mass', role: null, commits: 23, additions: 10, deletions: 2,
              active: true, tasks_created: 0, tasks_closed: 0, reporting_role: null,
              issues: null }] },
          { id: 'testing', name: 'QA / Testing', color: '#ef4444', description: 'QA reporters who create issues or tasks in Taiga',
            member_count: 1, active_count: 0, commit_count: 0, additions: 0, deletions: 0, teams: ['MGROC-GROCERY/taiga'],
            repositories: [], tasks: { created: 59, closed: 10 },
            efficiency: { method: 'reported_item_closure_rate', reported: 59, closed: 10, percent: 17 },
            employees: [{ id: 'login:sudip-sarkar', name: 'Sudip Sarkar', login: 'sudip-sarkar', role: 'qa', commits: 0, additions: 0, deletions: 0,
              active: false, tasks_created: 59, tasks_closed: 10, reporting_role: 'qa',
              issues: { reported: 59, open: 49, closed: 10, last_reported_at: '2026-09-29T00:00:00.000Z' } }] },
        ],
      },
      deliveryForecast: { targetSubmissionDate: '2026-12-31T00:00:00.000Z', predictedCompletionDate: '2026-11-15T00:00:00.000Z', deadlineReachable: true,
        deadlineProbability: 82, remainingWorkPercent: 40, remainingTasks: 4, activeDevelopers: 1, teamProgressPerWeek: 4.2,
        commitsPerDeveloperPerWeek: 1.2, taigaCompletionEfficiency: 66.7, estimatedDaysRemaining: 67, daysToDeadline: 90,
        repositoryCoverage: { frontend: 1, backend: 1, other: 0, combinedAnalysis: true }, calculationBasis: 'observed_project_progress_rate' },
      repositoryActivity: { total: 1, synced: 1 },
      gitActivity: { commits: 5, commit_rate_per_week: 1.2, pull_requests: 2, merge_rate_percent: 50 },
      risksAndPredictions: { overallRisk: 'medium', deadlineRisk: 'low', risks: [], predictions: { deadlineProbability: 0.8 } },
      aiNarrative: { summary: 'Delivery is progressing.', whatWentWell: [], whatNeedsAttention: [], recommendations: [] },
      visualData: [
        { id: 'work_completion', type: 'pie', title: 'Work completion', labels: ['Complete', 'Remaining'], datasets: [{ label: 'Percent', data: [60, 40] }] },
        { id: 'pr', type: 'pie', title: 'Pull request merge rate', labels: ['Merged', 'Not merged'], datasets: [{ label: 'Pull requests', data: [2, 6] }] },
        { id: 'git', type: 'line', title: 'Weekly Git activity', labels: ['2026-09-07', '2026-09-14', '2026-09-21'], datasets: [{ label: 'Commits', data: [4, 0, 8] }, { label: 'Pull requests', data: [1, 2, 3] }, { label: 'Merged PRs', data: [0, 1, 2] }] },
        { id: 'code', type: 'bar', title: 'Weekly code changes', labels: ['2026-09-07', '2026-09-14', '2026-09-21'], datasets: [{ label: 'Lines added', data: [50, 40, 20] }, { label: 'Lines deleted', data: [10, 15, 8] }] },
        { id: 'evidence', type: 'bar', title: 'Completion by evidence source', labels: ['Plan checklist', 'Taiga work', 'Repository verified'], datasets: [{ label: 'Complete %', data: [60, 55, null] }] },
        { id: 'status', type: 'pie', title: 'Taiga work status', labels: ['Closed', 'In progress', 'New'], datasets: [{ label: 'Tasks', data: [6, 3, 1] }] },
      ],
    },
  });
  const bytes = await fs.readFile(prepared.filePath);
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
  if (process.env.REPORT_PDF_QA_OUTPUT) await fs.copyFile(prepared.filePath, process.env.REPORT_PDF_QA_OUTPUT);
  const tempDirectory = path.dirname(prepared.filePath);
  await prepared.cleanup();
  await assert.rejects(fs.access(tempDirectory));
  console.log(`PASS: generated ${bytes.length}-byte PDF and removed its temporary directory.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
