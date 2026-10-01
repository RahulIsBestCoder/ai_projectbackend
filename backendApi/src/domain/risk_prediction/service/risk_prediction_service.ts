import { projectPlanDeadline } from '../../ai_intelligence/service/plan_schedule';
import { RiskPredictionModel } from '../models/risk_prediction_model';
import { IPredictionCreate, IPredictionUpdate, IGeneratedRisk, RiskLevel } from '../interface/risk_prediction_interface';
import { IServiceResult } from '../../../helper/common_interface';
import { ProviderFactory } from '../../ai_intelligence/providers/provider_factory';
import { IAiProvider } from '../../ai_intelligence/providers/base_provider';
import { loadScoringRules, scoringRulesContext } from '../../ai_intelligence/service/scoring_rules';
import { DeadlineForecast, computeDeadlineForecast } from './deadline_forecast';
import { createHash } from 'crypto';
import { IntegrationService } from '../../integration/service/integration_service';
import mongoose from 'mongoose';
import { AI_CONTEXT_CONFIG } from '../../../configuration/context.config';

/**
 * `RiskPredictionService` – Business logic for risk/prediction CRUD (plan §10).
 * Entries are append-only history, so create performs no duplicate check.
 */
export class RiskPredictionService {
  private readonly _predictionModel = new RiskPredictionModel();
  private readonly _integrationService = new IntegrationService();
  private readonly logName = 'risk_prediction_service';

  /**
   * Live active provider — re-resolved per access so the Grok / Ollama /
   * Gemini runtime switch (AI provider tabs) is honored here as well.
   */
  private get _aiProvider(): IAiProvider {
    return ProviderFactory.getProvider();
  }

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
      // Raw collection instead of the Mongoose model (plan P1-1): `predictDeadline`
      // stores non-schema fields (`on_time_probability`, `forecast_status`, flags, …)
      // that strict mode strips from model documents, and `.lean()`-style plain
      // objects avoid the `_doc` wrapper. Sorted latest first so `rows[0]` and
      // `prediction` are the current record, not the oldest seeded row.
      const db = global.db.connection.db!;
      const rows: any[] = await db.collection('risk_predictions')
        .find({ project_id: projectId, is_deleted: false }, {
          projection: {
            _id: 1, project_id: 1, kind: 1, risk_level: 1, predicted_date: 1, target_date: 1,
            on_time_probability: 1, forecast_status: 1, confidence_score: 1, factors: 1,
            summary: 1, mitigation: 1, source: 1, risk_key: 1, generated_at: 1,
            created_at: 1, updated_at: 1, data_quality_score: 1, model_version: 1,
            rules_version: 1, flags: 1,
          },
        })
        .sort({ updated_at: -1, created_at: -1 })
        .toArray();
      const predictions = rows
        .filter((p: any) => p.kind === 'prediction')
        .map((p: any) => ({
          ...p,
          predicted_finish_date: p.predicted_date ?? null,
          // Unknown values must be null, not 0 (plan P1-1): `predictDeadline` unsets
          // `confidence_score` when it has no probability evidence.
          confidence: typeof p.confidence_score === 'number' ? Math.round(p.confidence_score * 100) : null,
        }));
      return global.Helpers.makeSuccessServiceStatus('Predictions fetched.', {
        rows,
        count: rows.length,
        risks: rows.filter((p: any) => p.kind === 'risk'),
        prediction: predictions[0] ?? null,
        predictions,
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

      // Remaining scope: the shared completion truth — a ticked plan item is done,
      // unticked work falls back to Taiga/work-item evidence.
      const { resolveCompletion, loadCompletionInputs, forecastScope } =
        require('../../project/service/completion_resolver') as typeof import('../../project/service/completion_resolver');
      const completionInputs = await loadCompletionInputs(db, projectId);
      const truth = resolveCompletion(completionInputs.planItems, completionInputs.sourceItems);
      const scope = forecastScope(truth, new Date());
      const totalItems = scope.totalItems;
      const remainingItems = scope.remainingItems;
      // Story points only exist on work items; the checklist has no points, so the
      // point-based simulation falls back to item counts when the plan is the basis.
      const agg = await db.collection('work_items').aggregate([
        { $match: { project_id: projectId, is_deleted: false, status: { $ne: 'done' } } },
        { $group: { _id: null, points: { $sum: { $ifNull: ['$story_points', 0] } } } },
      ]).toArray();
      const remaining = truth.basis === 'user_checklist' ? remainingItems : (agg.length ? agg[0].points : 0);

      const mean = history.length ? history.reduce((a: number, b: number) => a + b, 0) / history.length : 0;
      const stdDev = history.length > 1
        ? Math.sqrt(history.reduce((a: number, v: number) => a + (v - mean) ** 2, 0) / (history.length - 1))
        : 0;
      const sprintDays = 14;

      // Monte Carlo (Box-Muller normal sampling of per-sprint velocity).
      const completions: number[] = [];
      if (totalItems > 0 && remainingItems === 0) {
        completions.push(Date.now());
      } else if (remaining > 0 && mean > 0) {
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
        forecast: totalItems > 0 && remainingItems === 0
          ? { status: 'complete', p50: new Date().toISOString(), p80: null, p95: null }
          : totalItems === 0 || mean <= 0 || remaining <= 0
            ? { status: 'insufficient_data', p50: null, p80: null, p95: null, message: 'Work items, estimated remaining scope and completed-sprint history are required.' }
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
        confidence_pct: { high: 85, medium: 60, low: 30 }[history.length >= 3 ? 'high' : history.length >= 1 ? 'medium' : 'low'],
        simulated_runs: completions.length,
      });
    } catch (err: any) {
      this.log('getCompletionForecast', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /* ==================== risk analysis (generate + store) ==================== */

  private static readonly RISK_LEVELS: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

  /*
   * Pull fresh data from a project integration before scoring: find the
   * project's newest active integration for `provider` and run its sync
   * (taiga: stories -> work_items, milestones -> sprints; github: commits +
   * pull requests). Best effort — a failed/slow sync never blocks the caller,
   * the last synced data is used instead.
   */
  private async _syncIntegrationBeforeAnalyze(projectId: string, provider: string, logCtx: string): Promise<any> {
    const result: any = { provider, connected: false, attempted: false, ok: false, status: null, error: null, last_sync_at: null };
    try {
      const db = global.db.connection.db!;
      const integ = await db
        .collection('integrations')
        .find({ project_id: projectId, provider, is_deleted: false })
        .sort({ created_at: -1 })
        .limit(1)
        .toArray();
      if (integ.length === 0) return result;

      const row = integ[0];
      result.connected = true;
      result.last_sync_at = row.last_sync_at || null;
      result.attempted = true;

      const ret = await this._integrationService.syncIntegration(String(row._id));
      result.status = ret.status ? (ret.data_sets?.status || 'success') : 'failed';
      result.ok = result.status === 'success';
      if (!result.ok) result.error = ret.status_message || `${provider} sync failed.`;

      const after = await db.collection('integrations').findOne({ _id: row._id });
      result.last_sync_at = after?.last_sync_at || result.last_sync_at;
    } catch (err: any) {
      result.attempted = true;
      result.ok = false;
      result.status = 'failed';
      result.error = err?.message || String(err);
      this.log(logCtx, `${provider} pre-sync failed: ${result.error}`, 'INFO');
    }
    return result;
  }

  /*
   * Roll up the accepted plan's execution checklist for the project (sprints,
   * tasks, milestones, deadlines, dependencies) plus overdue / stalled signals.
   */
  private async _assemblePlanExecution(projectId: string): Promise<any | null> {
    const db = global.db.connection.db!;
    const plans = await db
      .collection('ai_plans')
      .find({ project_id: projectId, status: 'accepted', is_deleted: false })
      .sort({ accepted_at: -1 })
      .limit(1)
      .toArray();
    if (plans.length === 0) return null;

    const plan = plans[0];
    const items = await db
      .collection('plan_execution_items')
      .find({ plan_id: String(plan._id), is_deleted: false })
      .toArray();
    if (items.length === 0) return null;

    const kinds = ['sprint', 'task', 'milestone', 'deadline', 'dependency'];
    const byKind: Record<string, { total: number; completed: number }> = {};
    for (const k of kinds) byKind[k] = { total: 0, completed: 0 };
    let total = 0;
    let completed = 0;
    const now = Date.now();
    const overdue: Array<{ kind: string; title: string; date: string }> = [];
    let incompleteDependencies = 0;

    for (const it of items) {
      const kind = String(it.kind);
      if (!byKind[kind]) byKind[kind] = { total: 0, completed: 0 };
      byKind[kind].total += 1;
      total += 1;
      if (it.is_completed) {
        byKind[kind].completed += 1;
        completed += 1;
      }
      const date = it.meta?.date;
      if ((kind === 'milestone' || kind === 'deadline') && !it.is_completed && date && new Date(date).getTime() < now) {
        overdue.push({ kind, title: it.title, date: String(date) });
      }
      if (kind === 'dependency' && !it.is_completed) incompleteDependencies += 1;
    }

    // Timeline window from sprint start/end dates in meta.
    const sprintStarts: number[] = [];
    const sprintEnds: number[] = [];
    for (const it of items) {
      if (it.kind !== 'sprint') continue;
      const s = it.meta?.start_date ? new Date(it.meta.start_date).getTime() : NaN;
      const e = it.meta?.end_date ? new Date(it.meta.end_date).getTime() : NaN;
      if (!Number.isNaN(s)) sprintStarts.push(s);
      if (!Number.isNaN(e)) sprintEnds.push(e);
    }
    let elapsedFraction: number | null = null;
    let window: { start: string; end: string } | null = null;
    if (sprintStarts.length && sprintEnds.length) {
      const start = Math.min(...sprintStarts);
      const end = Math.max(...sprintEnds);
      window = { start: new Date(start).toISOString().slice(0, 10), end: new Date(end).toISOString().slice(0, 10) };
      if (end > start) elapsedFraction = Math.max(0, Math.min(1, (now - start) / (end - start)));
    }
    const percent = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;
    const scheduleGap = elapsedFraction != null ? Math.round((elapsedFraction - completed / Math.max(1, total)) * 100) / 100 : null;

    return {
      plan_id: String(plan._id),
      plan_title: plan.title,
      total,
      completed,
      percent,
      by_kind: byKind,
      overdue_unchecked: overdue,
      incomplete_dependencies: incompleteDependencies,
      window,
      elapsed_fraction: elapsedFraction,
      schedule_gap: scheduleGap,
    };
  }

  /*
   * Gather the project signals the deterministic rules and the AI pass score.
   * Raw-driver reads, same approach as getCompletionForecast.
   */
  private async _assembleRiskSignals(projectId: string, taigaSync: any): Promise<any | null> {
    const db = global.db.connection.db!;
    const project = await db.collection('projects').findOne({
      _id: new mongoose.Types.ObjectId(projectId),
      is_deleted: false,
    });
    if (!project) return null;

    // LATEST VALUE PER METRIC TYPE
    const metricRows = await db
      .collection('analytics_snapshots')
      .find({ project_id: projectId, is_deleted: false, metric_type: { $in: ['health', 'velocity', 'quality', 'progress'] } })
      .sort({ captured_at: 1, created_at: 1 })
      .toArray();
    const metrics: Record<string, number | null> = { health: null, velocity: null, quality: null, progress: null };
    for (const r of metricRows) {
      metrics[String(r.metric_type)] = typeof r.value === 'number' ? r.value : null;
    }

    // SPRINTS
    const sprintDocs = await db
      .collection('sprints')
      .find({ project_id: projectId, is_deleted: false })
      .sort({ start_date: 1 })
      .toArray();
    const sprintByStatus: Record<string, number> = { planned: 0, active: 0, completed: 0 };
    for (const s of sprintDocs) {
      const key = String(s.status || 'planned');
      sprintByStatus[key] = (sprintByStatus[key] || 0) + 1;
    }
    const activeSprint = sprintDocs.find((s: any) => s.status === 'active') || null;
    const activeSprintOverdue = !!(activeSprint && activeSprint.end_date && new Date(activeSprint.end_date).getTime() < Date.now());

    // WORK ITEMS
    const statusRows = await db
      .collection('work_items')
      .aggregate([
        { $match: { project_id: projectId, is_deleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 }, points: { $sum: { $ifNull: ['$story_points', 0] } } } },
      ])
      .toArray();
    const wiByStatus: Record<string, { count: number; points: number }> = {};
    let wiTotal = 0;
    let wiBlocked = 0;
    for (const r of statusRows) {
      const key = String(r._id);
      wiByStatus[key] = { count: r.count, points: r.points };
      wiTotal += r.count;
      if (key === 'blocked') wiBlocked += r.count;
    }
    const openBugs = await db
      .collection('work_items')
      .countDocuments({ project_id: projectId, is_deleted: false, type: 'bug', status: { $ne: 'done' } });

    // COMPLETION FORECAST (reuse existing method)
    const forecastRet = await this.getCompletionForecast(projectId);
    const forecast = forecastRet.status ? forecastRet.data_sets : null;

    // TAIGA-ORIGIN WORK ITEMS (after the pre-analyze sync)
    const taigaStories = await db
      .collection('work_items')
      .countDocuments({ project_id: projectId, is_deleted: false, external_id: { $regex: '^taiga-us-' } });
    const lastSync = taigaSync?.last_sync_at ? new Date(taigaSync.last_sync_at).getTime() : null;
    const taiga = {
      connected: !!taigaSync?.connected,
      sync_attempted: !!taigaSync?.attempted,
      sync_ok: !!taigaSync?.ok,
      sync_status: taigaSync?.status || null,
      sync_error: taigaSync?.error || null,
      last_sync_at: taigaSync?.last_sync_at || null,
      hours_since_sync: lastSync ? Math.round((Date.now() - lastSync) / 3600000) : null,
      story_items: taigaStories,
    };

    // ACCEPTED PLAN EXECUTION CHECKLIST
    const planExecution = await this._assemblePlanExecution(projectId);

    return {
      project: { id: projectId, name: project.name, target_date: project.target_date || null },
      metrics,
      sprints: { total: sprintDocs.length, by_status: sprintByStatus, active_overdue: activeSprintOverdue, active_name: activeSprint?.name || null },
      work_items: { total: wiTotal, by_status: wiByStatus, blocked: wiBlocked, open_bugs: openBugs },
      forecast,
      taiga,
      plan_execution: planExecution,
    };
  }

  /*
   * Deterministic risk rules. One IGeneratedRisk per rule that fires.
   */
  private _deterministicRisks(sig: any): IGeneratedRisk[] {
    const risks: IGeneratedRisk[] = [];
    const f = sig.forecast || {};
    const velAvg = Number(f?.velocity?.average) || 0;
    const velStd = Number(f?.velocity?.std_dev) || 0;
    const remaining = Number(f?.remaining_story_points) || 0;
    const onTime = f?.forecast?.on_time_probability;
    const forecastStatus = f?.forecast?.status;

    // SCHEDULE
    if ((typeof onTime === 'number' && onTime < 0.5) || forecastStatus === 'insufficient_data') {
      const level: RiskLevel = typeof onTime === 'number' && onTime < 0.2 ? 'CRITICAL' : typeof onTime === 'number' && onTime < 0.5 ? 'HIGH' : 'MEDIUM';
      risks.push({
        risk_key: 'schedule',
        risk_level: level,
        summary: typeof onTime === 'number'
          ? `Only ${Math.round(onTime * 100)}% modelled probability of hitting the target date.`
          : 'Not enough delivery history to forecast the completion date.',
        factors: [
          `on_time_probability: ${typeof onTime === 'number' ? onTime : 'n/a'}`,
          `forecast_status: ${forecastStatus || 'n/a'}`,
          `remaining_story_points: ${remaining}`,
        ],
        mitigation: 'Re-scope the remaining backlog or move the target date; confirm sprint commitments against measured velocity.',
        confidence_score: 0.8,
        source: 'deterministic',
      });
    }

    // VELOCITY VOLATILITY
    if (velAvg > 0 && velStd > velAvg * 0.6) {
      const ratio = velStd / velAvg;
      risks.push({
        risk_key: 'velocity',
        risk_level: ratio > 1 ? 'HIGH' : 'MEDIUM',
        summary: `Sprint velocity is unstable (std dev ${velStd} vs average ${velAvg}).`,
        factors: [`velocity_average: ${velAvg}`, `velocity_std_dev: ${velStd}`, `ratio: ${Math.round(ratio * 100) / 100}`],
        mitigation: 'Investigate sprint-to-sprint disruption (scope changes, unplanned work, staffing) and stabilise commitments.',
        confidence_score: 0.7,
        source: 'deterministic',
      });
    }

    // SCOPE VS CAPACITY
    const remainingSprints = Math.max(1, (sig.sprints?.by_status?.active || 0) + (sig.sprints?.by_status?.planned || 0) || 3);
    if (velAvg > 0 && remaining > velAvg * remainingSprints) {
      const ratio = remaining / (velAvg * remainingSprints);
      risks.push({
        risk_key: 'scope',
        risk_level: ratio > 2 ? 'HIGH' : 'MEDIUM',
        summary: `Remaining scope (${remaining} pts) exceeds capacity of the remaining ${remainingSprints} sprint(s) at current velocity.`,
        factors: [`remaining_story_points: ${remaining}`, `velocity_average: ${velAvg}`, `remaining_sprints: ${remainingSprints}`, `ratio: ${Math.round(ratio * 100) / 100}`],
        mitigation: 'Cut or defer lower-priority backlog items, or add capacity for the remaining sprints.',
        confidence_score: 0.75,
        source: 'deterministic',
      });
    }

    // QUALITY
    const quality = sig.metrics?.quality;
    const openBugs = Number(sig.work_items?.open_bugs) || 0;
    if ((typeof quality === 'number' && quality < 60) || openBugs > 5) {
      const level: RiskLevel = (typeof quality === 'number' && quality < 40) || openBugs > 12 ? 'HIGH' : 'MEDIUM';
      risks.push({
        risk_key: 'quality',
        risk_level: level,
        summary: typeof quality === 'number' && quality < 60
          ? `Quality metric is low (${quality}/100) with ${openBugs} open bug(s).`
          : `${openBugs} open bug(s) not yet resolved.`,
        factors: [`quality_metric: ${typeof quality === 'number' ? quality : 'n/a'}`, `open_bugs: ${openBugs}`],
        mitigation: 'Prioritise a bug-burn-down and add regression coverage before taking on new feature work.',
        confidence_score: 0.7,
        source: 'deterministic',
      });
    }

    // BLOCKED WORK
    const blocked = Number(sig.work_items?.blocked) || 0;
    if (blocked > 0) {
      risks.push({
        risk_key: 'blocked',
        risk_level: blocked > 5 ? 'HIGH' : 'MEDIUM',
        summary: `${blocked} work item(s) are currently blocked.`,
        factors: [`blocked_work_items: ${blocked}`, `total_work_items: ${sig.work_items?.total || 0}`],
        mitigation: 'Run a blockers review; escalate external dependencies and reassign around internal ones.',
        confidence_score: 0.85,
        source: 'deterministic',
      });
    }

    // HEALTH
    const health = sig.metrics?.health;
    if (typeof health === 'number' && health < 70) {
      risks.push({
        risk_key: 'health',
        risk_level: health < 50 ? 'HIGH' : 'MEDIUM',
        summary: `Project health score is ${Math.round(health * 10) / 10}/100.`,
        factors: [`health_score: ${health}`, `velocity_metric: ${sig.metrics?.velocity ?? 'n/a'}`, `progress_metric: ${sig.metrics?.progress ?? 'n/a'}`],
        mitigation: 'Address the lowest-scoring health dimension first; recheck after the next snapshot.',
        confidence_score: 0.65,
        source: 'deterministic',
      });
    }

    // STALE ACTIVE SPRINT
    if (sig.sprints?.active_overdue) {
      risks.push({
        risk_key: 'stale_sprint',
        risk_level: 'HIGH',
        summary: `Active sprint "${sig.sprints.active_name}" is past its end date and still open.`,
        factors: [`active_sprint: ${sig.sprints.active_name}`],
        mitigation: 'Close out or formally extend the sprint; move unfinished items back to the backlog with a decision.',
        confidence_score: 0.9,
        source: 'deterministic',
      });
    }

    // TAIGA SYNC HEALTH
    const tg = sig.taiga || {};
    if (tg.connected && tg.sync_attempted && !tg.sync_ok) {
      risks.push({
        risk_key: 'taiga_sync',
        risk_level: 'HIGH',
        summary: `Live Taiga sync failed (${tg.sync_error || 'unknown error'}); analysis used the last synced data${tg.hours_since_sync != null ? ` from ${tg.hours_since_sync}h ago` : ''}.`,
        factors: [
          `sync_status: ${tg.sync_status || 'n/a'}`,
          `sync_error: ${tg.sync_error || 'n/a'}`,
          `hours_since_sync: ${tg.hours_since_sync ?? 'n/a'}`,
          `synced_stories: ${tg.story_items || 0}`,
        ],
        mitigation: 'Check the Taiga integration token and board slug; re-run the sync so the analysis reflects current board state.',
        confidence_score: 0.8,
        source: 'deterministic',
      });
    } else if (tg.connected && tg.sync_ok && (tg.hours_since_sync ?? 0) > 168) {
      risks.push({
        risk_key: 'taiga_sync',
        risk_level: 'MEDIUM',
        summary: `Taiga board data is stale (last successful sync ${tg.hours_since_sync}h ago).`,
        factors: [`hours_since_sync: ${tg.hours_since_sync}`, `synced_stories: ${tg.story_items || 0}`],
        mitigation: 'Schedule regular Taiga syncs so planning and risk analysis run on current board state.',
        confidence_score: 0.6,
        source: 'deterministic',
      });
    }

    // PLAN EXECUTION — OVERDUE UNCHECKED MILESTONES / DEADLINES
    const pe = sig.plan_execution;
    if (pe && Array.isArray(pe.overdue_unchecked) && pe.overdue_unchecked.length > 0) {
      const n = pe.overdue_unchecked.length;
      risks.push({
        risk_key: 'plan_overdue_items',
        risk_level: n > 2 ? 'HIGH' : 'MEDIUM',
        summary: `${n} plan milestone/deadline item(s) are past due and still unchecked in the execution checklist.`,
        factors: pe.overdue_unchecked.slice(0, 5).map((o: any) => `${o.kind}: ${o.title} (due ${o.date})`),
        mitigation: 'Review the execution checklist; close out completed items or re-baseline the milestone/deadline dates.',
        confidence_score: 0.85,
        source: 'deterministic',
      });
    }

    // PLAN EXECUTION — INCOMPLETE BLOCKING DEPENDENCIES
    if (pe && (pe.incomplete_dependencies || 0) > 0) {
      const d = pe.incomplete_dependencies;
      risks.push({
        risk_key: 'plan_dependencies',
        risk_level: d > 2 ? 'HIGH' : 'MEDIUM',
        summary: `${d} sprint dependency(ies) in the execution plan are not yet satisfied.`,
        factors: [`incomplete_dependencies: ${d}`, `plan: ${pe.plan_title}`],
        mitigation: 'Confirm each blocked sprint can start; resolve or resequence the unmet dependencies.',
        confidence_score: 0.75,
        source: 'deterministic',
      });
    }

    // PLAN EXECUTION — BEHIND THE PLAN TIMELINE
    if (pe && typeof pe.schedule_gap === 'number' && pe.schedule_gap > 0.25) {
      const elapsedPct = pe.elapsed_fraction != null ? Math.round(pe.elapsed_fraction * 100) : null;
      risks.push({
        risk_key: 'plan_progress',
        risk_level: pe.schedule_gap > 0.5 ? 'HIGH' : 'MEDIUM',
        summary: `Execution plan is ${pe.percent}% complete but ${elapsedPct ?? 'most'}% of its timeline has elapsed.`,
        factors: [
          `plan_completion_percent: ${pe.percent}`,
          `elapsed_fraction: ${pe.elapsed_fraction}`,
          `schedule_gap: ${pe.schedule_gap}`,
          pe.window ? `window: ${pe.window.start} to ${pe.window.end}` : 'window: n/a',
        ],
        mitigation: 'Re-plan the remaining checklist, add capacity, or move the plan end date to match real progress.',
        confidence_score: 0.7,
        source: 'deterministic',
      });
    }

    return risks;
  }

  /*
   * Prompt for the AI pass: compact facts + already-covered keys, asking only
   * for additional risks as a JSON array.
   */
  private _buildRiskPrompt(sig: any, deterministic: IGeneratedRisk[]): string {
    const m = sig.metrics || {};
    const w = sig.work_items || {};
    const s = sig.sprints || {};
    const f = sig.forecast || {};
    const tg = sig.taiga || {};
    const pe = sig.plan_execution;
    const bk = (k: string) => `${pe?.by_kind?.[k]?.completed || 0}/${pe?.by_kind?.[k]?.total || 0}`;
    const covered = deterministic.map((r) => r.risk_key).join(', ') || 'none';
    const factLines = [
      `Project: ${sig.project?.name || 'Unknown'}`,
      `Target date: ${sig.project?.target_date || 'none'}`,
      `Health metric: ${m.health ?? 'n/a'}`,
      `Velocity metric: ${m.velocity ?? 'n/a'}`,
      `Quality metric: ${m.quality ?? 'n/a'}`,
      `Progress metric: ${m.progress ?? 'n/a'}`,
      `Sprints: ${s.total || 0} (planned ${s.by_status?.planned || 0}, active ${s.by_status?.active || 0}, completed ${s.by_status?.completed || 0})`,
      `Active sprint overdue: ${s.active_overdue ? 'yes' : 'no'}`,
      `Work items: ${w.total || 0} total, blocked ${w.blocked || 0}, open bugs ${w.open_bugs || 0}`,
      `Velocity average: ${f?.velocity?.average ?? 'n/a'}, std dev: ${f?.velocity?.std_dev ?? 'n/a'}`,
      `Remaining story points: ${f?.remaining_story_points ?? 'n/a'}`,
      `On-time probability: ${f?.forecast?.on_time_probability ?? 'n/a'}`,
      `Taiga: ${tg.connected ? 'connected' : 'not connected'}, live sync ${tg.sync_status || 'n/a'}${tg.sync_error ? ' (' + tg.sync_error + ')' : ''}, ${tg.hours_since_sync ?? 'n/a'}h since last sync, ${tg.story_items || 0} synced stories`,
      pe
        ? `Execution plan "${pe.plan_title}": ${pe.percent}% complete (${pe.completed}/${pe.total} items); sprints ${bk('sprint')}, tasks ${bk('task')}, milestones ${bk('milestone')}, deadlines ${bk('deadline')}, dependencies ${bk('dependency')}; overdue unchecked items ${pe.overdue_unchecked?.length || 0}; incomplete dependencies ${pe.incomplete_dependencies || 0}; timeline elapsed ${pe.elapsed_fraction != null ? Math.round(pe.elapsed_fraction * 100) + '%' : 'n/a'}`
        : 'Execution plan: none accepted',
    ];
    return AI_CONTEXT_CONFIG.additionalRiskPrompt(factLines, covered);
  }

  /*
   * Tolerant parse of the AI pass output into IGeneratedRisk[].
   */
  private _parseAiRisks(raw: string): IGeneratedRisk[] {
    let text = String(raw || '').trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) text = fenced[1].trim();
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end <= start) return [];
    let parsed: any;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    const levels = RiskPredictionService.RISK_LEVELS;
    return parsed.slice(0, 5).map((r: any, i: number) => {
      const lvl = String(r?.risk_level || '').toUpperCase() as RiskLevel;
      return {
        risk_key: `ai-${i + 1}`,
        risk_level: levels.includes(lvl) ? lvl : 'MEDIUM',
        summary: String(r?.summary || 'Unspecified risk.').slice(0, 500),
        factors: Array.isArray(r?.factors) ? r.factors.map((x: any) => String(x).slice(0, 200)) : [],
        mitigation: r?.mitigation ? String(r.mitigation).slice(0, 500) : undefined,
        confidence_score: 0.5,
        source: 'ai' as const,
      };
    });
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-11
   * @Function: analyzeRisks
   */
  public async analyzeRisks(projectId: string, options: { sync?: boolean; ai?: boolean; provider?: string; model?: string } = {}): Promise<IServiceResult> {
    this.initLog();
    this.log('analyzeRisks', ['Request:', JSON.stringify({ projectId })]);
    try {
      // REFRESH TAIGA DATA FIRST — best effort, never blocks the analysis
      const taigaSync = options.sync === false ? { connected: false, status: 'skipped' } : await this._syncIntegrationBeforeAnalyze(projectId, 'taiga', 'analyzeRisks');

      // GET THE PROJECT SIGNALS
      const sig = await this._assembleRiskSignals(projectId, taigaSync);
      if (!sig) {
        this.log('Project not found:', projectId, 'ERROR');
        return global.Helpers.makeBadServiceStatus('Project not found.');
      }

      const deterministic = this._deterministicRisks(sig);

      // AI PASS — best effort, never fails the request
      let aiRisks: IGeneratedRisk[] = [];
      let aiUsed = false;
      try {
        if (options.ai !== false) {
        const provider = await ProviderFactory.readyProvider(options.provider, options.model);
        const rules = scoringRulesContext();
        const riskPrompt = this._buildRiskPrompt(sig, deterministic);
        const raw = await provider.generate(rules ? [rules, '## Task', riskPrompt].join('\n\n') : riskPrompt);
        ProviderFactory.recordUsage(provider);
        aiRisks = this._parseAiRisks(raw);
        aiUsed = aiRisks.length > 0;
        }
      } catch (aiErr: any) {
        this.log('analyzeRisks', `AI pass unavailable (${aiErr?.message || aiErr})`, 'INFO');
      }

      const risks = [...deterministic, ...aiRisks];
      const generatedAt = new Date();

      // UPSERT INTO risk_predictions (raw driver — same pattern as integration sync)
      const db = global.db.connection.db!;
      const col = db.collection('risk_predictions');
      const firedKeys = deterministic.map((r) => r.risk_key);

      if (deterministic.length > 0) {
        await col.bulkWrite(
          deterministic.map((r) => ({
            updateOne: {
              filter: { project_id: projectId, kind: 'risk', risk_key: r.risk_key },
              update: {
                $set: {
                  risk_level: r.risk_level,
                  summary: r.summary,
                  factors: r.factors,
                  mitigation: r.mitigation || null,
                  confidence_score: r.confidence_score,
                  source: 'deterministic',
                  generated_at: generatedAt,
                  updated_at: generatedAt,
                  is_deleted: false,
                  deleted_at: null,
                },
                $setOnInsert: { project_id: projectId, kind: 'risk', created_at: generatedAt },
              },
              upsert: true,
            },
          })),
          { ordered: false },
        );
      }

      // Deterministic rules that no longer fire — retire their rows.
      await col.updateMany(
        { project_id: projectId, kind: 'risk', source: 'deterministic', risk_key: { $nin: firedKeys } },
        { $set: { is_deleted: true, deleted_at: generatedAt, updated_at: generatedAt } },
      );

      // AI risks — replace the whole set each run.
      await col.updateMany(
        { project_id: projectId, kind: 'risk', source: 'ai' },
        { $set: { is_deleted: true, deleted_at: generatedAt, updated_at: generatedAt } },
      );
      if (aiRisks.length > 0) {
        await col.insertMany(
          aiRisks.map((r) => ({
            project_id: projectId,
            kind: 'risk',
            risk_key: r.risk_key,
            risk_level: r.risk_level,
            summary: r.summary,
            factors: r.factors,
            mitigation: r.mitigation || null,
            confidence_score: r.confidence_score,
            source: 'ai',
            generated_at: generatedAt,
            is_deleted: false,
            created_at: generatedAt,
            updated_at: generatedAt,
          })),
        );
      }

      const order = RiskPredictionService.LEVEL_ORDER;
      let overall: RiskLevel = 'LOW';
      for (const r of risks) {
        if ((order[r.risk_level] ?? 4) < (order[overall] ?? 4)) overall = r.risk_level;
      }
      const counts: Record<string, number> = {};
      for (const r of risks) counts[r.risk_level] = (counts[r.risk_level] || 0) + 1;

      this.log('Analyze risks result:', JSON.stringify({ deterministic: deterministic.length, ai: aiRisks.length, overall, taiga_synced: sig.taiga?.sync_ok || false }));

      return global.Helpers.makeSuccessServiceStatus('Risk analysis complete.', {
        project_id: projectId,
        generated_at: generatedAt.toISOString(),
        overall_risk_level: overall,
        counts,
        ai_used: aiUsed,
        taiga_sync: {
          connected: sig.taiga?.connected || false,
          attempted: sig.taiga?.sync_attempted || false,
          ok: sig.taiga?.sync_ok || false,
          status: sig.taiga?.sync_status || null,
          error: sig.taiga?.sync_error || null,
          last_sync_at: sig.taiga?.last_sync_at || null,
        },
        plan_execution: sig.plan_execution
          ? {
              plan_title: sig.plan_execution.plan_title,
              percent: sig.plan_execution.percent,
              total: sig.plan_execution.total,
              completed: sig.plan_execution.completed,
              overdue_unchecked: sig.plan_execution.overdue_unchecked.length,
              incomplete_dependencies: sig.plan_execution.incomplete_dependencies,
            }
          : null,
        risks,
      });
    } catch (err: any) {
      this.log('analyzeRisks', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /* ==================== deadline prediction (generate + store) ==================== */

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-11
   * @Function: predictDeadline
   * @Description: Refresh Taiga + Git data, run the completion forecast, and
   *   persist a deadline prediction row (kind: 'prediction', risk_key:
   *   'deadline') keyed to the project. Idempotent — one row, upserted.
   */
  public async predictDeadline(projectId: string, options: { sync?: boolean; ai?: boolean } = {}): Promise<IServiceResult> {
    this.initLog();
    this.log('predictDeadline', ['Request:', JSON.stringify({ projectId, ...options })]);
    try {
      const db = global.db.connection.db!;
      const project = await db.collection('projects').findOne({
        _id: new mongoose.Types.ObjectId(projectId),
        is_deleted: false,
      });
      if (!project) {
        this.log('Project not found:', projectId, 'ERROR');
        return global.Helpers.makeBadServiceStatus('Project not found.');
      }

      // REFRESH TAIGA + GIT DATA FIRST — best effort, never blocks the prediction
      const taigaSync = options.sync === false ? { connected: false, status: 'skipped' } : await this._syncIntegrationBeforeAnalyze(projectId, 'taiga', 'predictDeadline');
      const gitSync = options.sync === false ? { connected: false, status: 'skipped' } : await this._syncIntegrationBeforeAnalyze(projectId, 'github', 'predictDeadline');

      // Backend owns every number (rule book §11–15); AI only explains the result.
      const inputs = await this._deadlineForecastInputs(db, projectId, project);
      const fc = computeDeadlineForecast({
        ...inputs, projectId, asOf: new Date(), rulesVersion: loadScoringRules()?.version || 'unversioned',
      });

      const predictionFilter = { project_id: projectId, kind: 'prediction', risk_key: 'deadline' };
      const previous = await db.collection('risk_predictions').findOne(predictionFilter, { projection: { explanation: 1 } });
      // Boundary states are facts from project data. Do not ask an AI model to reinterpret them.
      const explanation = await this._explainDeadlineForecast(
        fc,
        previous?.explanation,
        options.ai !== false && fc.status !== 'complete' && fc.status !== 'not_started',
      );

      const predictedDate = fc.deterministic.predicted_finish_date
        ? new Date(fc.deterministic.predicted_finish_date)
        : null;
      const targetDate = fc.deterministic.target_date ? new Date(fc.deterministic.target_date) : null;
      const onTime = fc.probability.on_time;
      const summary = explanation.summary;

      const factors: string[] = [
        `model: ${fc.model_version}`,
        `rules_version: ${fc.rules_version}`,
        `as_of: ${fc.as_of}`,
        `forecast_status: ${fc.status}`,
        `work_unit: ${fc.work_unit}`,
        `remaining_items: ${fc.scope.remaining_items}`,
        `velocity_per_working_day: ${fc.velocity.per_working_day} (last ${fc.velocity.window_working_days} working days)`,
        `predicted_finish: ${fc.deterministic.predicted_finish_date ?? 'n/a'}`,
        `target_date: ${fc.deterministic.target_date ?? 'n/a'}${fc.target_source ? ` (${fc.target_source})` : ''}`,
        `slack_working_days: ${fc.deterministic.slack_working_days ?? 'n/a'}`,
        `on_time_probability: ${onTime ?? `n/a (${fc.probability.reason})`}`,
        `data_quality_score: ${fc.data_quality.score ?? 'n/a'}`,
        ...fc.flags.map(flag => `flag: ${flag}`),
        `taiga_sync: ${taigaSync.connected ? taigaSync.status : 'not connected'}`,
        `git_sync: ${gitSync.connected ? gitSync.status : 'not connected'}`,
      ];

      const generatedAt = new Date();
      await db.collection('risk_predictions').updateOne(
        predictionFilter,
        {
          $set: {
            risk_level: fc.risk_level,
            predicted_date: predictedDate,
            target_date: targetDate,
            on_time_probability: onTime,
            ...(onTime !== null ? { confidence_score: onTime } : {}),
            forecast_status: fc.status,
            factors,
            summary,
            source: 'rules',
            model_version: fc.model_version,
            rules_version: fc.rules_version,
            forecast_key: fc.forecast_key,
            as_of: fc.as_of,
            flags: fc.flags,
            data_quality_score: fc.data_quality.score,
            forecast: fc,
            explanation,
            generated_at: generatedAt,
            updated_at: generatedAt,
            is_deleted: false,
            deleted_at: null,
          },
          // A missing probability must not be stored as a numeric confidence.
          ...(onTime === null ? { $unset: { confidence_score: '' } } : {}),
          $setOnInsert: { project_id: projectId, kind: 'prediction', created_at: generatedAt },
        },
        { upsert: true },
      );

      this.log('Deadline prediction result:', JSON.stringify({
        status: fc.status, risk: fc.risk_level, predicted: fc.deterministic.predicted_finish_date, on_time: onTime, explanation: explanation.generated_by,
      }));

      return global.Helpers.makeSuccessServiceStatus('Deadline prediction complete.', {
        project_id: projectId,
        generated_at: generatedAt.toISOString(),
        risk_level: fc.risk_level,
        predicted_date: predictedDate ? predictedDate.toISOString() : null,
        target_date: targetDate ? targetDate.toISOString() : null,
        on_time_probability: onTime,
        confidence: null,
        confidence_score: null,
        data_quality: fc.data_quality,
        calibration: fc.probability.calibration,
        summary,
        explanation,
        forecast: {
          status: fc.status,
          p10: fc.probability.p10,
          p50: fc.probability.p50,
          p80: fc.probability.p80,
          p90: fc.probability.p90,
          p95: null,
          optimistic: fc.probability.p10,
          pessimistic: fc.probability.p90,
        },
        velocity: fc.velocity,
        remaining_items: fc.scope.remaining_items,
        remaining_story_points: null,
        flags: fc.flags,
        reasons: fc.reasons,
        rule_forecast: fc,
        taiga_sync: { connected: taigaSync.connected, attempted: taigaSync.attempted, ok: taigaSync.ok, status: taigaSync.status, error: taigaSync.error, last_sync_at: taigaSync.last_sync_at },
        git_sync: { connected: gitSync.connected, attempted: gitSync.attempted, ok: gitSync.ok, status: gitSync.status, error: gitSync.error, last_sync_at: gitSync.last_sync_at },
        factors,
      });
    } catch (err: any) {
      this.log('predictDeadline', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  private static readonly DEADLINE_EXPLANATION_PROMPT_VERSION = 'deadline-explanation-v1';

  /** Count-based forecast inputs: Taiga tasks when synced, otherwise project work items. */
  private async _deadlineForecastInputs(db: any, projectId: string, project: any) {
    const toDate = (value: any): Date | null => {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const taigaFilter = { project_id: projectId, is_deleted: { $ne: true }, taiga_task_id: { $exists: true, $ne: null } };
    const [taigaRows, integrations, plans] = await Promise.all([
      db.collection('taiga_tasks').find(taigaFilter).project({ is_closed: 1, status_name: 1, finished_date: 1, created_date: 1 }).toArray(),
      db.collection('integrations').find({ project_id: projectId, is_deleted: { $ne: true }, provider: { $in: ['github', 'taiga'] } })
        .project({ provider: 1, repository_name: 1, last_sync_at: 1 }).toArray(),
      db.collection('ai_plans').find({ project_id: projectId, is_deleted: { $ne: true } })
        .project({ status: 1, input: 1, plan: 1, updated_at: 1, created_at: 1 }).toArray(),
    ]);

    let workUnit: 'TAIGA_TASK_COUNT' | 'WORK_ITEM_COUNT';
    let rows: { closed: boolean; started: boolean; acceptedAt: Date | null; createdAt: Date | null }[];
    let acceptanceDateBasis: string;
    const indicatesStarted = (status: any, closed: boolean): boolean => {
      if (closed) return true;
      const normalized = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
      return ['in_progress', 'active', 'doing', 'development', 'review', 'code_review', 'testing', 'qa', 'blocked'].includes(normalized);
    };
    if (taigaRows.length) {
      workUnit = 'TAIGA_TASK_COUNT';
      acceptanceDateBasis = 'TAIGA_FINISHED_DATE';
      rows = taigaRows.map((row: any) => ({
        closed: !!row.is_closed,
        started: indicatesStarted(row.status_name, !!row.is_closed),
        acceptedAt: toDate(row.finished_date),
        createdAt: toDate(row.created_date),
      }));
    } else {
      workUnit = 'WORK_ITEM_COUNT';
      acceptanceDateBasis = 'WORK_ITEM_COMPLETED_AT_OR_UPDATED_AT';
      const items = await db.collection('work_items').find({ project_id: projectId, is_deleted: { $ne: true } })
        .project({ status: 1, completed_at: 1, updated_at: 1, created_at: 1 }).toArray();
      rows = items.map((item: any) => {
        const closed = ['done', 'completed', 'closed'].includes(String(item.status || '').toLowerCase());
        return { closed, started: indicatesStarted(item.status, closed), acceptedAt: closed ? toDate(item.completed_at || item.updated_at) : null, createdAt: toDate(item.created_at) };
      });
    }
    // Shared completion truth: a ticked plan item IS delivered and replaces the
    // source scan as the forecast's scope; unticked work falls back to the source.
    const { resolveCompletion, loadCompletionInputs, forecastScope } =
      require('../../project/service/completion_resolver') as typeof import('../../project/service/completion_resolver');
    const completionInputs = await loadCompletionInputs(db, projectId);
    const truth = resolveCompletion(completionInputs.planItems, completionInputs.sourceItems);
    const now = new Date();
    const scope = forecastScope(truth, now);
    if (truth.basis === 'user_checklist') {
      workUnit = scope.workUnit as any;
      acceptanceDateBasis = scope.acceptanceDateBasis;
    }

    const createdDates = rows.map(row => row.createdAt).filter((date): date is Date => date !== null);

    let targetDate = toDate(project.target_date);
    let targetSource: string | null = targetDate ? 'PROJECT_TARGET_DATE' : null;
    if (!targetDate && toDate(project.end_date)) {
      targetDate = toDate(project.end_date);
      targetSource = 'PROJECT_END_DATE';
    }
    if (!targetDate && plans.length) {
      const plan: any = plans.slice().sort((a: any, b: any) =>
        Number(b.status === 'accepted') - Number(a.status === 'accepted')
        || new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())[0];
      targetDate = projectPlanDeadline(plan);
      if (targetDate) targetSource = 'LATEST_PLAN_DEADLINE';
    }

    const usingChecklist = truth.basis === 'user_checklist';
    return {
      workUnit,
      acceptanceDateBasis,
      completion_truth: {
        basis: truth.basis,
        percent: truth.percent,
        plan_track: { total: truth.plan_track.total, completed: truth.plan_track.completed, ticked: truth.plan_track.ticked },
        source_track: truth.source_track,
        flags: truth.flags,
        notes: truth.notes,
      },
      totalItems: usingChecklist ? scope.totalItems : rows.length,
      remainingItems: usingChecklist ? scope.remainingItems : rows.filter(row => !row.closed).length,
      startedItems: usingChecklist ? scope.acceptedDates.length : rows.filter(row => row.started).length,
      acceptedDates: usingChecklist
        ? scope.acceptedDates
        : rows.filter(row => row.closed && row.acceptedAt).map(row => row.acceptedAt as Date),
      firstItemCreatedAt: createdDates.length ? new Date(Math.min(...createdDates.map(date => date.getTime()))) : null,
      targetDate,
      targetSource,
      sources: integrations.map((integration: any) => ({
        name: `${integration.provider}:${integration.repository_name || ''}`,
        lastSyncAt: toDate(integration.last_sync_at),
      })),
    };
  }

  /**
   * AI narrative for an already calculated forecast. Cached per forecast + prompt + model,
   * and rejected when it introduces numbers that are not in the calculation.
   */
  private async _explainDeadlineForecast(fc: DeadlineForecast, previous: any, useAi: boolean): Promise<any> {
    const promptVersion = RiskPredictionService.DEADLINE_EXPLANATION_PROMPT_VERSION;
    const heuristic = {
      generated_by: 'heuristic', key: null, forecast_key: fc.forecast_key, provider: null, model: null,
      prompt_version: promptVersion, validation: useAi ? null : 'AI_NOT_REQUESTED',
      ...this._heuristicDeadlineExplanation(fc),
    };
    if (!useAi) {
      return previous?.generated_by === 'ai' && previous?.forecast_key === fc.forecast_key ? previous : heuristic;
    }

    let provider: IAiProvider;
    try {
      provider = await ProviderFactory.readyProvider();
    } catch (err: any) {
      return { ...heuristic, validation: `AI_UNAVAILABLE: ${String(err?.message || err).slice(0, 200)}` };
    }
    const key = createHash('sha256')
      .update(JSON.stringify({ forecast_key: fc.forecast_key, prompt_version: promptVersion, provider: provider.type, model: provider.model }))
      .digest('hex');
    if (previous?.generated_by === 'ai' && previous?.key === key) return previous;

    const prompt = AI_CONTEXT_CONFIG.deadlineExplanationPrompt(scoringRulesContext(), fc);

    try {
      const raw = await provider.generate(prompt);
      ProviderFactory.recordUsage(provider);
      const text = String(raw || '').trim();
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const body = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
      const parsed = JSON.parse(body);
      const list = (value: any): string[] => (Array.isArray(value) ? value : [])
        .map((item: any) => String(item).trim()).filter(Boolean).slice(0, 5).map((item: string) => item.slice(0, 400));
      const output = {
        summary: String(parsed?.summary || '').trim().slice(0, 800),
        drivers: list(parsed?.drivers),
        risks: list(parsed?.risks),
        actions: list(parsed?.actions),
        missing_data: list(parsed?.missing_data),
      };
      if (!output.summary) throw new Error('AI returned an empty summary.');
      const unsupported = this._unsupportedNumbers([output.summary, ...output.drivers, ...output.risks, ...output.actions, ...output.missing_data].join(' '), fc);
      if (unsupported.length) {
        return { ...heuristic, provider: provider.type, model: provider.model, validation: `REJECTED_UNSUPPORTED_NUMBERS: ${unsupported.slice(0, 5).join(', ')}` };
      }
      return {
        generated_by: 'ai', key, forecast_key: fc.forecast_key, provider: provider.type, model: provider.model,
        prompt_version: promptVersion, validation: 'PASSED', ...output, generated_at: new Date().toISOString(),
      };
    } catch (err: any) {
      return { ...heuristic, provider: provider.type, model: provider.model, validation: `AI_FAILED: ${String(err?.message || err).slice(0, 200)}` };
    }
  }

  /** Numbers in the AI text that do not come from the calculated forecast (or the rule book's fixed gates). */
  private _unsupportedNumbers(text: string, fc: DeadlineForecast): string[] {
    const normalize = (value: string) => String(Number(value));
    const allowed = new Set<string>(['0', '1', '2', '3', '4', '5', '8', '20', '24', '40', '100', '10000', '104']);
    for (const match of JSON.stringify(fc).match(/-?\d+(?:\.\d+)?/g) || []) {
      const value = Number(match);
      allowed.add(normalize(match));
      allowed.add(String(Math.abs(value)));
      if (value > 0 && value <= 1) {
        allowed.add(String(Math.round(value * 100)));
        allowed.add(String(Math.round(value * 1000) / 10));
      }
    }
    return [...new Set((text.match(/\d+(?:\.\d+)?/g) || []).map(normalize))].filter(value => !allowed.has(value));
  }

  private _heuristicDeadlineExplanation(fc: DeadlineForecast) {
    const d = fc.deterministic;
    const p = fc.probability;
    const parts: string[] = [];
    if (fc.status === 'complete') {
      parts.push('This project is already completed: all counted work items are closed. No completion-date prediction is required.');
    } else if (fc.status === 'not_started') {
      parts.push('This project has not started yet: no counted work item has progress or completion evidence. A completion date cannot be predicted until work begins.');
    } else if (fc.status === 'insufficient_data') {
      parts.push(`No forecast yet (${fc.reasons.join(', ') || 'INSUFFICIENT_DATA'}).`);
    } else if (fc.status === 'stalled') {
      parts.push(`No finite forecast: nothing was closed in the last ${fc.velocity.window_working_days} working days while ${fc.scope.remaining_items} items remain (ZERO_THROUGHPUT).`);
    } else {
      parts.push(`At ${fc.velocity.per_working_day} closed items per working day over the last ${fc.velocity.window_working_days} working days, the ${fc.scope.remaining_items} open items need about ${d.predicted_remaining_working_days_rounded} working days, finishing around ${d.predicted_finish_date} (${d.accuracy_label}).`);
    }
    if (d.target_date) {
      parts.push(`Target ${d.target_date} (${fc.target_source}): ${d.available_working_days} working days available, slack ${d.slack_working_days ?? 'n/a'} working days.`);
    } else {
      parts.push('No target date is set, so on-time probability is unavailable.');
    }
    if (p.on_time !== null) parts.push(`Modeled on-time probability ${Math.round(p.on_time * 100)}% (${p.calibration}).`);
    else if (d.target_date && p.reason) parts.push(`On-time probability unavailable (${p.reason}).`);
    if (fc.flags.length) parts.push(`Flags: ${fc.flags.join(', ')}.`);
    return {
      summary: parts.join(' '),
      drivers: [],
      risks: fc.flags,
      actions: [],
      missing_data: [...new Set([...fc.reasons, ...(p.reason ? [p.reason] : [])])],
    };
  }
}
