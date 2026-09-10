import { RiskPredictionModel } from '../models/risk_prediction_model';
import { IPredictionCreate, IPredictionUpdate } from '../interface/risk_prediction_interface';
import { IServiceResult } from '../../../helper/common_interface';
import mongoose from 'mongoose';

/**
 * `RiskPredictionService` – Business logic for risk/prediction CRUD (plan §10).
 * Entries are append-only history, so create performs no duplicate check.
 */
export class RiskPredictionService {
  private readonly _predictionModel = new RiskPredictionModel();
  private readonly logName = 'risk_prediction_service';

  private initLog(): void {
    /* parity with plan convention */
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: createPrediction
   */
  public async createPrediction(param: IPredictionCreate): Promise<IServiceResult> {
    this.initLog();
    this.log('createPrediction', ['Request : ', param]);
    try {
      const newPrediction = await this._predictionModel.addNewRecord(param);
      this.log('Add new prediction result:', newPrediction);
      return global.Helpers.makeSuccessServiceStatus('Prediction created.', newPrediction);
    } catch (err: any) {
      this.log('createPrediction', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: getPrediction
   */
  public async getPrediction(predictionId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getPrediction', ['Request : ', predictionId]);
    try {
      const prediction = await this._predictionModel.findByAny({ _id: predictionId });
      if (!prediction) {
        return global.Helpers.makeBadServiceStatus('Prediction not found.');
      }
      return global.Helpers.makeSuccessServiceStatus('Prediction fetched.', prediction);
    } catch (err: any) {
      this.log('getPrediction', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: updatePrediction
   */
  public async updatePrediction(predictionId: string, param: IPredictionUpdate): Promise<IServiceResult> {
    this.initLog();
    this.log('updatePrediction', ['Request : ', { predictionId, param }]);
    try {
      const updated = await this._predictionModel.updateAnyRecord({ _id: predictionId }, param);
      this.log('Update prediction result:', updated);
      return global.Helpers.makeSuccessServiceStatus('Prediction updated.', updated);
    } catch (err: any) {
      this.log('updatePrediction', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: deletePrediction
   */
  public async deletePrediction(predictionId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('deletePrediction', ['Request : ', predictionId]);
    try {
      const deleted = await this._predictionModel.updateAnyRecord({ _id: predictionId }, { is_deleted: true });
      this.log('Delete prediction result:', deleted);
      return global.Helpers.makeSuccessServiceStatus('Prediction deleted.', deleted);
    } catch (err: any) {
      this.log('deletePrediction', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  public async getByProject(projectId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getByProject', ['Request : ', projectId]);
    try {
      const predictions = await this._predictionModel.findAllByAny({ project_id: projectId, is_deleted: false });
      return global.Helpers.makeSuccessServiceStatus('Predictions fetched.', {
        rows: predictions,
        count: predictions.length,
        risks: predictions.filter((p: any) => p.kind === 'risk'),
        predictions: predictions.filter((p: any) => p.kind === 'prediction'),
      });
    } catch (err: any) {
      this.log('getByProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /* ==================== risks (plan §10) ==================== */

  private static readonly LEVEL_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getRisksByProject
   * @Description: Risk entries (kind='risk') sorted by severity, with
   *               level counts. Optional `level` query filter.
   */
  public async getRisksByProject(projectId: string, level?: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getRisksByProject', ['Request : ', { projectId, level }]);
    try {
      const filter: any = { project_id: projectId, kind: 'risk', is_deleted: false };
      if (level) filter.risk_level = String(level).toUpperCase();
      const rows: any[] = await this._predictionModel.findAllByAny(filter);
      const order = RiskPredictionService.LEVEL_ORDER;
      rows.sort((a: any, b: any) =>
        ((order[a.risk_level] ?? 4) - (order[b.risk_level] ?? 4))
        || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.risk_level] = (counts[r.risk_level] || 0) + 1;
      return global.Helpers.makeSuccessServiceStatus('Risks fetched.', {
        rows,
        count: rows.length,
        counts,
        top_risk: rows.length ? { level: rows[0].risk_level, summary: rows[0].summary, factors: rows[0].factors } : null,
      });
    } catch (err: any) {
      this.log('getRisksByProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /* ==================== completion forecast (plan §10) ==================== */

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getCompletionForecast
   * @Description: Monte Carlo completion forecast (p50/p80/p95) from
   *               historical sprint velocity vs remaining story points.
   */
  public async getCompletionForecast(projectId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getCompletionForecast', ['Request : ', projectId]);
    try {
      const db = global.db.connection.db!;
      const project = await db.collection('projects').findOne({
        _id: new mongoose.Types.ObjectId(projectId), is_deleted: false,
      });
      if (!project) return global.Helpers.makeBadServiceStatus('Project not found.');

      // Historical velocity: completed sprints, chronological.
      const sprints = await db.collection('sprints')
        .find({ project_id: projectId, status: 'completed', is_deleted: false })
        .sort({ start_date: 1 }).toArray();
      const history = sprints.map((s: any) => s.completed_points || 0).filter((v: number) => v > 0);

      // Remaining scope: story points of not-done work items.
      const agg = await db.collection('work_items').aggregate([
        { $match: { project_id: projectId, is_deleted: false, status: { $ne: 'done' } } },
        { $group: { _id: null, points: { $sum: { $ifNull: ['$story_points', 0] } }, items: { $sum: 1 } } },
      ]).toArray();
      const remaining = agg.length ? agg[0].points : 0;
      const remainingItems = agg.length ? agg[0].items : 0;

      const mean = history.length ? history.reduce((a: number, b: number) => a + b, 0) / history.length : 0;
      const stdDev = history.length > 1
        ? Math.sqrt(history.reduce((a: number, v: number) => a + (v - mean) ** 2, 0) / (history.length - 1))
        : 0;
      const sprintDays = 14;

      // Monte Carlo (Box-Muller normal sampling of per-sprint velocity).
      const completions: number[] = [];
      if (remaining <= 0) {
        completions.push(Date.now());
      } else if (mean > 0) {
        for (let i = 0; i < 500; i++) {
          let done = 0, needed = 0;
          while (done < remaining && needed < 52) {
            const u1 = Math.random() || 1e-9, u2 = Math.random();
            const v = Math.max(1, mean + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * stdDev);
            done += v; needed++;
          }
          completions.push(Date.now() + needed * sprintDays * 86400000);
        }
        completions.sort((a, b) => a - b);
      }
      const pct = (p: number) => completions.length
        ? new Date(completions[Math.min(completions.length - 1, Math.floor(p * completions.length))]).toISOString()
        : null;
      const targetMs = project.target_date ? new Date(project.target_date).getTime() : null;

      return global.Helpers.makeSuccessServiceStatus('Completion forecast fetched.', {
        project_id: projectId,
        remaining_story_points: remaining,
        remaining_items: remainingItems,
        velocity: {
          average: Math.round(mean * 10) / 10,
          std_dev: Math.round(stdDev * 10) / 10,
          history,
          sprints_observed: history.length,
          sprint_length_days: sprintDays,
        },
        forecast: remaining <= 0
          ? { status: 'complete', p50: new Date().toISOString() }
          : mean <= 0
            ? { status: 'insufficient_data', message: 'No completed sprints with delivered points yet.' }
            : {
              status: 'simulated',
              p50: pct(0.5), p80: pct(0.8), p95: pct(0.95),
              optimistic: pct(0.05), pessimistic: pct(0.99),
              target_date: project.target_date || null,
              on_time_probability: targetMs
                ? Math.round((completions.filter((c) => c <= targetMs).length / completions.length) * 100) / 100
                : null,
            },
        confidence: history.length >= 3 ? 'high' : history.length >= 1 ? 'medium' : 'low',
        simulated_runs: completions.length,
      });
    } catch (err: any) {
      this.log('getCompletionForecast', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }
}
