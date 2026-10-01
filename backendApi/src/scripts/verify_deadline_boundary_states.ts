import assert from 'node:assert/strict';
import { computeDeadlineForecast, DeadlineForecastInput } from '../domain/risk_prediction/service/deadline_forecast';

const base: DeadlineForecastInput = {
  projectId: 'boundary-test',
  asOf: new Date('2026-09-29T12:00:00Z'),
  rulesVersion: 'test',
  totalItems: 4,
  remainingItems: 4,
  startedItems: 0,
  acceptedDates: [],
  firstItemCreatedAt: new Date('2026-09-01T00:00:00Z'),
  targetDate: new Date('2026-12-31T00:00:00Z'),
  targetSource: 'TEST',
  sources: [],
  workUnit: 'WORK_ITEM_COUNT',
  acceptanceDateBasis: 'TEST',
};

const notStarted = computeDeadlineForecast(base);
assert.equal(notStarted.status, 'not_started');
assert.equal(notStarted.probability.reason, 'PROJECT_NOT_STARTED');
assert.equal(notStarted.deterministic.predicted_finish_date, null);
assert.equal(notStarted.scope.started_items, 0);

const completed = computeDeadlineForecast({
  ...base,
  remainingItems: 0,
  startedItems: 4,
  acceptedDates: [
    new Date('2026-09-10T00:00:00Z'),
    new Date('2026-09-12T00:00:00Z'),
    new Date('2026-09-14T00:00:00Z'),
    new Date('2026-09-16T00:00:00Z'),
  ],
});
assert.equal(completed.status, 'complete');
assert.ok(completed.reasons.includes('PROJECT_ALREADY_COMPLETE'));
assert.equal(completed.scope.remaining_items, 0);

const activeWithoutRecentThroughput = computeDeadlineForecast({ ...base, startedItems: 1 });
assert.equal(activeWithoutRecentThroughput.status, 'stalled');

const empty = computeDeadlineForecast({ ...base, totalItems: 0, remainingItems: 0, startedItems: 0 });
assert.equal(empty.status, 'insufficient_data');

console.log('Deadline boundary-state verification passed.');
