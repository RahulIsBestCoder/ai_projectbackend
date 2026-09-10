import { Types } from 'mongoose';
import { AnalyticsModel } from '../models/analytics_model';
import { ISnapshotCreate, ISnapshotUpdate } from '../interface/analytics_interface';
import { IServiceResult } from '../../../helper/common_interface';

/**
 * `AnalyticsService` – Business logic for metric-snapshot CRUD (plan §09).
 * Snapshots are append-only, so create performs no duplicate check.
 */
export class AnalyticsService {
  private readonly _snapshotModel = new AnalyticsModel();
  private readonly logName = 'analytics_service';

  private initLog(): void {
    /* parity with plan convention */
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: createSnapshot
   */
  public async createSnapshot(param: ISnapshotCreate): Promise<IServiceResult> {
    this.initLog();
    this.log('createSnapshot', ['Request : ', param]);
    try {
      const newSnapshot = await this._snapshotModel.addNewRecord(param);
      this.log('Add new snapshot result:', newSnapshot);
      return global.Helpers.makeSuccessServiceStatus('Snapshot created.', newSnapshot);
    } catch (err: any) {
      this.log('createSnapshot', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: getSnapshot
   */
  public async getSnapshot(snapshotId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getSnapshot', ['Request : ', snapshotId]);
    try {
      const snapshot = await this._snapshotModel.findByAny({ _id: snapshotId });
      if (!snapshot) {
        return global.Helpers.makeBadServiceStatus('Snapshot not found.');
      }
      return global.Helpers.makeSuccessServiceStatus('Snapshot fetched.', snapshot);
    } catch (err: any) {
      this.log('getSnapshot', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: updateSnapshot
   */
  public async updateSnapshot(snapshotId: string, param: ISnapshotUpdate): Promise<IServiceResult> {
    this.initLog();
    this.log('updateSnapshot', ['Request : ', { snapshotId, param }]);
    try {
      const updated = await this._snapshotModel.updateAnyRecord({ _id: snapshotId }, param);
      this.log('Update snapshot result:', updated);
      return global.Helpers.makeSuccessServiceStatus('Snapshot updated.', updated);
    } catch (err: any) {
      this.log('updateSnapshot', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: deleteSnapshot
   */
  public async deleteSnapshot(snapshotId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('deleteSnapshot', ['Request : ', snapshotId]);
    try {
      const deleted = await this._snapshotModel.updateAnyRecord({ _id: snapshotId }, { is_deleted: true });
      this.log('Delete snapshot result:', deleted);
      return global.Helpers.makeSuccessServiceStatus('Snapshot deleted.', deleted);
    } catch (err: any) {
      this.log('deleteSnapshot', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getByProject
   */
  public async getByProject(projectId: string, metricType?: string, period?: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getByProject', ['Request : ', { projectId, metricType, period }]);
    try {
      const filter: any = { project_id: projectId, is_deleted: false };
      if (metricType) filter.metric_type = metricType;
      if (period) filter.period = period;

      const snapshots = await this._snapshotModel.findAllByAny(filter);

      // Group by metric_type and get latest for each
      const latest: Record<string, any> = {};
      const trends: Record<string, any[]> = {};
      for (const snap of snapshots) {
        const type = snap.metric_type;
        if (!latest[snap.captured_at] || new Date(snap.captured_at) > new Date(latest[type]?.captured_at || 0)) {
          latest[type] = snap;
        }
        if (!trends[type]) trends[type] = [];
        trends[type].push({ value: snap.value, captured_at: snap.captured_at, breakdown: snap.breakdown });
      }

      return global.Helpers.makeSuccessServiceStatus('Analytics fetched.', {
        project_id: projectId,
        latest,
        trends,
        summary: {
          health: latest.health?.value || null,
          velocity: latest.velocity?.value || null,
          progress: latest.progress?.value || null,
          quality: latest.quality?.value || null,
        },
      });
    } catch (err: any) {
      this.log('getByProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /* ==================== project health (plan §09) ==================== */

  private static readonly METRIC_LABELS: Record<string, string> = {
    health: 'Overall Health', velocity: 'Velocity', progress: 'Progress', quality: 'Quality',
  };

  private _oid(id: string): any {
    return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : id;
  }

  private _band(score: number): string {
    if (score >= 80) return 'good';
    if (score >= 60) return 'fair';
    return 'at_risk';
  }

  private _trend(delta: number, tolerance = 1): string {
    if (delta > tolerance) return 'improving';
    if (delta < -tolerance) return 'declining';
    return 'stable';
  }

  private _avg(rows: any[]): number | null {
    if (!rows.length) return null;
    return Math.round((rows.reduce((s, r) => s + (r.value || 0), 0) / rows.length) * 10) / 10;
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getProjectHealth
   * @Description: Composite health: current score per metric, 7-day delta,
   *               overall band and the latest risk signal.
   */
  public async getProjectHealth(projectId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getProjectHealth', ['Request : ', projectId]);
    try {
      const db = global.db.connection.db!;
      const project = await db.collection('projects').findOne({ _id: this._oid(projectId) });
      if (!project) return global.Helpers.makeBadServiceStatus('Project not found.');

      const snaps = await db.collection('analytics_snapshots')
        .find({ project_id: projectId, is_deleted: false })
        .sort({ captured_at: 1 }).toArray();

      const now = Date.now();
      const WEEK = 7 * 86400000;
      const dimensions = Object.keys(AnalyticsService.METRIC_LABELS).map((metric) => {
        const pts = snaps.filter((s: any) => s.metric_type === metric && s.value != null);
        const current = pts.length ? pts[pts.length - 1].value : null;
        const recent = pts.filter((p: any) => now - new Date(p.captured_at).getTime() <= WEEK);
        const prior = pts.filter((p: any) => {
          const age = now - new Date(p.captured_at).getTime();
          return age > WEEK && age <= 2 * WEEK;
        });
        const recentAvg = this._avg(recent);
        const priorAvg = this._avg(prior);
        const delta = recentAvg != null && priorAvg != null ? Math.round((recentAvg - priorAvg) * 10) / 10 : null;
        return {
          metric,
          label: AnalyticsService.METRIC_LABELS[metric],
          value: current,
          week_avg: recentAvg,
          delta_7d: delta,
          trend: delta == null ? 'stable' : this._trend(delta),
          status: current == null ? 'unknown' : this._band(current),
        };
      });

      const healthDim = dimensions.find((d) => d.metric === 'health');
      const score = healthDim && healthDim.value != null ? healthDim.value : (project.health_score ?? null);

      const latestRisk = await db.collection('risk_predictions')
        .find({ project_id: projectId, kind: 'risk', is_deleted: false })
        .sort({ created_at: -1 }).limit(1).toArray();
      const byLevel = await db.collection('risk_predictions').aggregate([
        { $match: { project_id: projectId, kind: 'risk', is_deleted: false } },
        { $group: { _id: '$risk_level', count: { $sum: 1 } } },
      ]).toArray();
      const riskCounts: Record<string, number> = {};
      byLevel.forEach((r: any) => { riskCounts[r._id] = r.count; });

      return global.Helpers.makeSuccessServiceStatus('Project health fetched.', {
        project: { _id: project._id, name: project.name, health_score: project.health_score },
        overall: {
          score,
          status: score == null ? 'unknown' : this._band(score),
          trend: healthDim ? healthDim.trend : 'stable',
        },
        dimensions,
        risk: {
          latest: latestRisk.length ? {
            level: latestRisk[0].risk_level,
            summary: latestRisk[0].summary,
            factors: latestRisk[0].factors,
            confidence_score: latestRisk[0].confidence_score,
            created_at: latestRisk[0].created_at,
          } : null,
          counts: riskCounts,
        },
        computed_at: new Date().toISOString(),
      });
    } catch (err: any) {
      this.log('getProjectHealth', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getTrends
   * @Description: Time-series for one metric (default health). Rows are the
   *               raw daily snapshots; `points` is a compact date/value list
   *               ready for Recharts, with a simple 7-point moving average.
   */
  public async getTrends(projectId: string, metric: string, period: string, days: number): Promise<IServiceResult> {
    this.initLog();
    this.log('getTrends', ['Request : ', { projectId, metric, period, days }]);
    try {
      const db = global.db.connection.db!;
      const project = await db.collection('projects').findOne({ _id: this._oid(projectId) });
      if (!project) return global.Helpers.makeBadServiceStatus('Project not found.');

      const m = AnalyticsService.METRIC_LABELS[metric] ? metric : 'health';
      const windowDays = Math.min(Math.max(days || 56, 7), 365);
      const since = new Date(Date.now() - windowDays * 86400000);

      const rows: any[] = await db.collection('analytics_snapshots').find({
        project_id: projectId, metric_type: m, is_deleted: false,
        captured_at: { $gte: since },
      }).sort({ captured_at: 1 }).toArray();

      const points = rows.map((r: any) => ({
        date: new Date(r.captured_at).toISOString().slice(0, 10),
        value: r.value,
      }));

      // 7-point moving average for a smoother overlay line
      const moving_avg = points.map((_, i) => {
        const slice = points.slice(Math.max(0, i - 6), i + 1).filter((p) => p.value != null);
        const avg = this._avg(slice.map((p) => ({ value: p.value })));
        return { date: points[i].date, value: avg };
      });

      const values = points.map((p) => p.value).filter((v) => v != null) as number[];
      const first = values.length ? values[0] : null;
      const last = values.length ? values[values.length - 1] : null;

      return global.Helpers.makeSuccessServiceStatus('Metric trends fetched.', {
        project: { _id: project._id, name: project.name },
        metric: m,
        label: AnalyticsService.METRIC_LABELS[m],
        period: period || 'daily',
        window_days: windowDays,
        points,
        moving_avg,
        summary: {
          count: values.length,
          min: values.length ? Math.min(...values) : null,
          max: values.length ? Math.max(...values) : null,
          average: this._avg(values.map((v) => ({ value: v }))),
          change: first != null && last != null ? Math.round((last - first) * 10) / 10 : null,
        },
      });
    } catch (err: any) {
      this.log('getTrends', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getHealthStrategies
   * @Description: Deterministic improvement strategies derived from the
   *               health dimensions (band + 7d trend) so the frontend can
   *               show actionable guidance next to the health card.
   */
  public async getHealthStrategies(projectId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getHealthStrategies', ['Request : ', projectId]);
    try {
      const health = await this.getProjectHealth(projectId);
      if (!health.status) return health;
      const data: any = health.data_sets;
      const strategies = data.dimensions.flatMap((d: any) => {
        const weak = d.status === 'at_risk' || d.status === 'fair';
        const declining = d.trend === 'declining';
        if (!weak && !declining) return [];
        const base: Record<string, { title: string; actions: string[] }> = {
          health: {
            title: 'Raise overall project health',
            actions: ['Clear blocked work items this sprint', 'Rebalance assignments for overloaded members'],
          },
          velocity: {
            title: 'Improve delivery velocity',
            actions: ['Break down large stories (>8 pts)', 'Reduce work-in-progress per member'],
          },
          progress: {
            title: 'Accelerate milestone progress',
            actions: ['Re-plan scope against target date', 'Close stale in-review items'],
          },
          quality: {
            title: 'Improve quality signals',
            actions: ['Increase PR review coverage', 'Add regression tests for hot files'],
          },
        };
        const s = base[d.metric];
        if (!s) return [];
        return [{
          metric: d.metric,
          label: d.label,
          status: d.status,
          trend: d.trend,
          value: d.value,
          delta_7d: d.delta_7d,
          title: s.title,
          actions: s.actions,
          priority: d.status === 'at_risk' ? 'high' : declining ? 'medium' : 'low',
        }];
      });
      return global.Helpers.makeSuccessServiceStatus('Health strategies fetched.', {
        project: data.project,
        overall: data.overall,
        strategies,
        count: strategies.length,
      });
    } catch (err: any) {
      this.log('getHealthStrategies', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }
}
