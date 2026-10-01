import assert from 'node:assert/strict';
import { buildTaigaSprintSummary } from '../domain/reporting/service/taiga_sprint_summary';

const tasks = [
  { taiga_task_id: 1, integration_id: 'a', taiga_milestone_id: 10, status_name: 'Ready for QA', is_blocked: true },
  { taiga_task_id: 2, integration_id: 'a', taiga_milestone_id: 10, status_name: 'Released', is_closed: true },
  { taiga_task_id: 3, integration_id: 'a', status_name: 'New' },
  { taiga_task_id: 4, integration_id: 'a', taiga_milestone_id: 10, is_deleted: true },
];
const result = buildTaigaSprintSummary([...tasks, tasks[0]], [
  { taiga_milestone_id: 10, name: 'Sprint 1' }, { taiga_milestone_id: 20, name: 'Sprint 2' },
]);
assert.equal(result.totalTasks, 3);
assert.deepEqual(result.rows.map(row => row.total), [2, 0, 1]);
assert.equal(result.rows[0].blocked, 1);
assert.equal(result.rows[0].closed, 1);
assert.equal(result.rows[2].sprintName, 'No sprint assigned');
assert.deepEqual(result.rows[0].statuses, [{ name: 'Ready for QA', count: 1 }, { name: 'Released', count: 1 }]);
assert.ok(result.rows.every(row => row.statuses.reduce((sum: number, status: any) => sum + status.count, 0) === row.total));
assert.equal(buildTaigaSprintSummary([], []).totalTasks, 0);
console.log('PASS: custom status counts, duplicate/deleted exclusion, closed/blocked subsets, empty and unassigned sprints.');
