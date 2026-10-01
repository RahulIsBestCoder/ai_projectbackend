import { Types } from 'mongoose';

// Serialize refreshes within this process: both repository syncs contribute to
// the same project, rather than overwriting its metrics with one repo's counts.
const pending = new Map<string, Promise<void>>();

export function refreshProjectData(projectId: string): Promise<void> {
  const previous = pending.get(projectId) || Promise.resolve();
  const next = previous.catch(() => undefined).then(() => refresh(projectId));
  pending.set(projectId, next);
  return next.finally(() => { if (pending.get(projectId) === next) pending.delete(projectId); });
}

export function calculateSyncMetrics(items: any[], sprints: any[], commits: number, pullRequests: number) {
  const completed = items.filter(item => item.status === 'done').length;
  const history = sprints.filter(s => s.status === 'completed' && Number.isFinite(s.completed_points));
  return [
    { metric_type: 'progress', value: items.length ? Math.round(completed / items.length * 1000) / 10 : null,
      breakdown: { basis: 'work_item_count', completed, total: items.length } },
    { metric_type: 'velocity', value: history.length ? history.reduce((sum, s) => sum + s.completed_points, 0) / history.length : null,
      breakdown: { basis: 'points_per_completed_sprint', sprints: history.length } },
    { metric_type: 'git_commits', value: commits, breakdown: { basis: 'all_project_repositories' } },
    { metric_type: 'git_pull_requests', value: pullRequests, breakdown: { basis: 'all_project_repositories' } },
  ];
}

async function refresh(projectId: string): Promise<void> {
  const db = global.db.connection.db!;
  const filter = { project_id: projectId, is_deleted: { $ne: true } };
  const [items, sprints, commits, pullRequests] = await Promise.all([
    db.collection('work_items').find(filter).toArray(),
    db.collection('sprints').find(filter).toArray(),
    db.collection('commits').countDocuments(filter),
    db.collection('pull_requests').countDocuments(filter),
  ]);
  const now = new Date();
  const metrics = calculateSyncMetrics(items, sprints, commits, pullRequests);
  await db.collection('analytics_snapshots').insertMany(metrics.map(metric => ({
    ...metric, project_id: projectId, period: 'daily', calculation_version: 'sync-v1',
    captured_at: now, created_at: now, updated_at: now, is_deleted: false,
  })));
  // Dynamic import avoids the integration/risk service module cycle. Explicitly
  // disable source sync here so refreshing a prediction cannot recurse.
  const { RiskPredictionService } = require('../../risk_prediction/service/risk_prediction_service') as typeof import('../../risk_prediction/service/risk_prediction_service');
  const risk = new RiskPredictionService();
  const risks = await risk.analyzeRisks(projectId, { sync: false, ai: false });
  if (!risks.status) throw new Error(risks.status_message || 'Risk refresh failed');
  const prediction = await risk.predictDeadline(projectId, { sync: false, ai: false });
  if (!prediction.status) throw new Error(prediction.status_message || 'Prediction refresh failed');
  await db.collection('projects').updateOne({ _id: new Types.ObjectId(projectId) }, { $set: {
    data_refreshed_at: now, progress: metrics[0].value,
    // Historical reports/plans are not silently rewritten on a source sync.
    report_data_changed_at: now,
  } });
}
