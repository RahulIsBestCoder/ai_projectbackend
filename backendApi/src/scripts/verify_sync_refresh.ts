import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { calculateSyncMetrics, refreshProjectData } from '../domain/integration/service/project_data_refresh';
import { IntegrationService } from '../domain/integration/service/integration_service';
import { RiskPredictionService } from '../domain/risk_prediction/service/risk_prediction_service';
import { AnalyticsService } from '../domain/analytics/service/analytics_service';
import { ProjectService } from '../domain/project/service/project_service';

async function main() {
  const success = (message: string, data: any): any => ({ status: true, status_code: 200, status_message: message, data_sets: data });
  (global as any).logs = { writelog: () => undefined };
  (global as any).Helpers = { makeSuccessServiceStatus: success, makeBadServiceStatus: (message: string) => ({ status: false, status_message: message }) };
  const empty = calculateSyncMetrics([], [], 52, 148);
  assert.equal(empty[0].value, null);
  assert.equal(empty[1].value, null);
  const metrics = calculateSyncMetrics([{ status: 'done' }, { status: 'in_progress' }], [{ status: 'completed', completed_points: 8 }], 52, 148);
  assert.equal(metrics[0].value, 50);
  assert.equal(metrics[1].value, 8);
  assert.equal(metrics[2].value, 52);
  assert.equal(calculateSyncMetrics([{ status: 'in_progress' }], [], 0, 0)[0].value, 0);

  const rows: Record<string, any[]> = {};
  const events: string[] = [];
  const db: any = { collection: (name: string) => ({
    find: () => ({ toArray: async () => [] }),
    countDocuments: async () => name === 'commits' ? 52 : 148,
    insertMany: async (docs: any[]) => { rows[name] = docs; events.push('metrics'); },
    updateOne: async () => { events.push('project'); },
    createIndex: async () => undefined,
    bulkWrite: async (ops: any[]) => { rows[name] = ops.map(op => op.updateOne.update.$set); },
  }) };
  (global as any).db = { connection: { db }, Schema: mongoose.Schema, models: mongoose.models, model: mongoose.model.bind(mongoose) };
  const originalAnalyze = RiskPredictionService.prototype.analyzeRisks;
  const originalPredict = RiskPredictionService.prototype.predictDeadline;
  const originalFetch = globalThis.fetch;
  try {
    RiskPredictionService.prototype.analyzeRisks = async (_id, options) => {
      assert.equal(options?.sync, false); assert.equal(options?.ai, false);
      events.push('risks'); return success('ok', {});
    };
    RiskPredictionService.prototype.predictDeadline = async (_id, options) => {
      assert.equal(options?.sync, false); events.push('prediction'); return success('ok', {});
    };
    await refreshProjectData('111111111111111111111111');
    assert.deepEqual(events, ['metrics', 'risks', 'prediction', 'project']);
    assert.equal(rows.analytics_snapshots[2].value, 52);

    const service: any = Object.create(IntegrationService.prototype);
    service.persistTaigaTasks = async () => undefined;
    service.refreshDerivedData = async () => { events.push('derived'); };
    service._aiService = { rebuildProjectContext: async () => { events.push('context'); return { status: true }; } };
    globalThis.fetch = (async (input: string, options: any) => {
      assert.equal(options.headers['x-disable-pagination'], 'True');
      const path = new URL(input).pathname;
      const data = path.endsWith('by_slug') ? { id: 1 }
        : path.endsWith('/points') ? [{ id: 130017552, value: 5 }]
        : path.endsWith('/userstories') ? [{ id: 10, subject: 'Story', points: { role: 130017552 }, milestone: 2, is_closed: true }]
        : path.endsWith('/milestones') ? [{ id: 2, name: 'Sprint', closed: true }]
        : path.endsWith('/stats') ? {} : [];
      return { ok: true, json: async () => data };
    }) as any;
    let finished: string | undefined;
    const result = await service.syncTaiga({ project_id: '111111111111111111111111', token: 'test', repository_name: 'board' }, 'integration', db,
      async (status: string) => { finished = status; });
    assert.equal(result.data_sets?.status, 'success', result.status_message);
    assert.equal(finished, 'success');
    assert.equal(rows.work_items[0].story_points, 5);
    assert.equal(rows.work_items[0].source, 'taiga');
    assert.equal(rows.work_items[0].assignee_id, null);
    assert.equal(rows.sprints[0].completed_points, 5);
    assert.deepEqual(events.slice(-2), ['derived', 'context']);
    service.refreshDerivedData = async () => { throw new Error('database unavailable'); };
    const partial = await service.syncTaiga({ project_id: '111111111111111111111111', token: 'test', repository_name: 'board' }, 'integration', db, async () => undefined);
    assert.equal(partial.data_sets.status, 'partial');
    assert.equal(partial.data_sets.derived_data_refreshed, false);

    const analytics: any = Object.create(AnalyticsService.prototype);
    analytics._snapshotModel = { findAllByAny: async () => [
      { metric_type: 'progress', value: 0, captured_at: '2026-09-15' },
      { metric_type: 'progress', value: 90, captured_at: '2026-09-01' },
    ] };
    assert.equal((await analytics.getByProject('project')).data_sets.summary.progress, 0);
    // Completion scope now comes from the shared resolver: with no accepted plan the
    // basis is `source_only`, so these work_items rows are what the forecast counts.
    let scope = { total: 3, remainingItems: 3, points: 0 };
    const workItemRows = () => Array.from({ length: scope.total }, (_, i) => ({
      _id: `wi-${i}`, title: `Item ${i}`, status: i < scope.total - scope.remainingItems ? 'done' : 'todo',
      completed_at: null, updated_at: null, created_at: null, due_date: null, sprint_id: null,
    }));
    const chain = (docs: any[]): any => ({
      sort: () => chain(docs), limit: () => chain(docs), project: () => chain(docs), toArray: async () => docs,
    });
    (global as any).db.connection.db = { collection: (name: string) => ({
      findOne: async () => ({ name: 'Project', is_deleted: false }),
      find: () => chain(name === 'work_items' ? workItemRows() : []),
      aggregate: () => ({ toArray: async () => [{ points: scope.points, items: scope.remainingItems }] }),
      countDocuments: async () => scope.total,
    }) };
    const forecast: any = Object.create(RiskPredictionService.prototype);
    assert.equal((await forecast.getCompletionForecast('111111111111111111111111')).data_sets.forecast.status, 'insufficient_data');
    scope = { total: 0, remainingItems: 0, points: 0 };
    assert.equal((await forecast.getCompletionForecast('111111111111111111111111')).data_sets.forecast.status, 'insufficient_data');
    scope = { total: 3, remainingItems: 0, points: 0 };
    assert.equal((await forecast.getCompletionForecast('111111111111111111111111')).data_sets.forecast.status, 'complete');

    const project: any = Object.create(ProjectService.prototype);
    project._projectModel = { findByAny: async () => ({ _id: 'project' }) };
    project.syncProject = async () => success('synced', { status: 'success' });
    project._aiService = {
      assessProjectHealth: async (_id: string, provider: string, model: string) => {
        assert.equal(provider, 'ollama'); assert.equal(model, 'model-from-ui');
        return success('assessed', { health: 70 });
      },
      rebuildProjectContext: async () => success('context', {}),
    };
    project._riskService = {
      analyzeRisks: async (_id: string, options: any) => {
        assert.equal(options.sync, false); assert.equal(options.provider, 'ollama');
        return success('risks', []);
      },
      predictDeadline: async () => success('prediction', {}),
      getCompletionForecast: async () => success('forecast', { forecast: { status: 'insufficient_data' } }),
    };
    project._analyticsService = { getProjectHealth: async () => success('health', { overall: { score: 70 } }) };
    const combined = await project.refreshAiAssessment('111111111111111111111111', { provider: 'ollama', model: 'model-from-ui' });
    assert.equal(combined.data_sets.assessment.health, 70);
    assert.equal(combined.data_sets.health.overall.score, 70);
    console.log('Sync refresh verification passed.');
  } finally {
    RiskPredictionService.prototype.analyzeRisks = originalAnalyze;
    RiskPredictionService.prototype.predictDeadline = originalPredict;
    globalThis.fetch = originalFetch;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
