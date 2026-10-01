import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { RiskPredictionService } from '../domain/risk_prediction/service/risk_prediction_service';

/**
 * Verifies `RiskPredictionService.getByProject` against the P1-1 contract:
 * latest-first sort (no stale seeded row), `_doc`-free plain rows, the
 * non-schema fields (`forecast_status`, `on_time_probability`) present,
 * `predicted_finish_date` mapped from `predicted_date`, and unknown values as
 * `null` — never `0`. No database required; the collection is stubbed.
 * Run: npm run verify:predictions
 */

interface Row { _id: string; kind: string; [key: string]: any }

/** Emulates a MongoDB descending sort on updated_at, then created_at (missing = lowest). */
function sortDesc(rows: Row[]): Row[] {
  const value = (r: Row, field: string) => (r[field] ? r[field].getTime() : -Infinity);
  return [...rows].sort((a, b) => {
    for (const field of ['updated_at', 'created_at']) {
      if (value(a, field) !== value(b, field)) return value(b, field) - value(a, field);
    }
    return 0;
  });
}

function stubDb(rows: Row[]): void {
  const captured: any = {};
  const db: any = {
    collection: (name: string) => ({
      find: (filter: any, options: any) => {
        captured[name] = { filter, options };
        return {
          sort: (sortSpec: any) => ({
            toArray: async () => {
              assert.deepEqual(captured[name].filter, { project_id: 'p1', is_deleted: false });
              assert.equal(captured[name].options.projection.forecast_status, 1);
              assert.equal(captured[name].options.projection.on_time_probability, 1);
              assert.deepEqual(sortSpec, { updated_at: -1, created_at: -1 });
              return sortDesc(rows);
            },
          }),
        };
      },
    }),
  };
  (global as any).db = { connection: { db }, Schema: mongoose.Schema, models: mongoose.models, model: mongoose.model.bind(mongoose) };
}

function stubGlobals(): void {
  (global as any).logs = { writelog: () => undefined };
  (global as any).Helpers = {
    makeSuccessServiceStatus: (message: string, data: any): any => ({ status: true, status_code: 200, status_message: message, data_sets: data }),
    makeBadServiceStatus: (message: string): any => ({ status: false, status_message: message }),
  };
}

async function main() {
  stubGlobals();

  // Scenario 1: seeded history + a current deadline row written by predictDeadline.
  const withRows: Row[] = [
    { _id: 'old', project_id: 'p1', kind: 'prediction', risk_key: 'deadline', risk_level: 'HIGH',
      predicted_date: new Date('2026-01-01T00:00:00.000Z'), confidence_score: undefined,
      created_at: new Date('2026-01-01T00:00:00.000Z'), updated_at: undefined },
    { _id: 'r1', project_id: 'p1', kind: 'risk', risk_level: 'HIGH', summary: 'Active sprint overdue',
      created_at: new Date('2026-02-01T00:00:00.000Z') },
    { _id: 'new', project_id: 'p1', kind: 'prediction', risk_key: 'deadline', risk_level: 'MODERATE',
      predicted_date: new Date('2027-08-24T00:00:00.000Z'), target_date: new Date('2027-05-08T00:00:00.000Z'),
      on_time_probability: 0.44, forecast_status: 'forecast', confidence_score: 0.44,
      created_at: new Date('2026-09-20T00:00:00.000Z'), updated_at: new Date('2026-09-20T00:00:00.000Z') },
  ];
  stubDb(withRows);
  const ret = await new RiskPredictionService().getByProject('p1');
  assert.equal(ret.status, true);
  const data: any = ret.data_sets;
  assert.equal(data.count, 3);
  assert.equal(data.rows[0]._id, 'new', 'rows must be newest first');
  assert.equal(data.prediction._id, 'new', 'prediction shortcut must be the latest row, not the oldest seeded one');
  assert.equal(data.predictions[0].predicted_finish_date.toISOString(), '2027-08-24T00:00:00.000Z');
  assert.equal(data.predictions[0].confidence, 44, 'confidence_score 0.44 becomes 44');
  assert.equal(data.prediction.forecast_status, 'forecast', 'non-schema field must survive (no strict-mode strip)');
  assert.equal(data.prediction.on_time_probability, 0.44);
  assert.equal(data.predictions[1].confidence, null, 'missing confidence_score becomes null, not 0');
  assert.equal(data.predictions[1].predicted_finish_date.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(data.risks.length, 1);
  assert.equal(data.risks[0]._id, 'r1');
  console.log('Scenario 1 passed: latest deadline row first, snake_case date, non-schema fields present.');

  // Scenario 2: no prediction stored at all (the "Not synced yet" case).
  stubDb([]);
  const empty = await new RiskPredictionService().getByProject('p1');
  const emptyData: any = empty.data_sets;
  assert.equal(emptyData.count, 0);
  assert.equal(emptyData.prediction, null);
  assert.deepEqual(emptyData.predictions, []);
  console.log('Scenario 2 passed: empty project yields prediction: null.');

  // Scenario 3: stalled project — row exists, predicted_date is null.
  stubDb([
    { _id: 'stalled', project_id: 'p1', kind: 'prediction', risk_key: 'deadline', risk_level: 'HIGH',
      predicted_date: null, on_time_probability: null, forecast_status: 'stalled', flags: ['ZERO_THROUGHPUT'],
      created_at: new Date('2026-09-20T00:00:00.000Z'), updated_at: new Date('2026-09-20T00:00:00.000Z') },
  ]);
  const stalled = await new RiskPredictionService().getByProject('p1');
  const stalledData: any = stalled.data_sets;
  assert.equal(stalledData.prediction.forecast_status, 'stalled');
  assert.equal(stalledData.prediction.predicted_finish_date, null, 'null date must stay null (no Invalid Date)');
  assert.equal(stalledData.prediction.confidence, null);
  console.log('Scenario 3 passed: stalled row keeps a null date with forecast_status to explain it.');

  console.log('getByProject verification passed.');
}

main().catch((err) => { console.error(err); process.exit(1); });
