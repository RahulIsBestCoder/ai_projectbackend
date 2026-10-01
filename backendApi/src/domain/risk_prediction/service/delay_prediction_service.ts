import mongoose from 'mongoose';
import { IServiceResult } from '../../../helper/common_interface';
import {
  DELAY_MODEL_VERSION, DRIVER_SENSITIVITY, DriverInput, DriverKey,
  computeDelayProbability, shiftFinishDate,
} from './delay_prediction';

/**
 * `DelayPredictionService` - powers the Predictive Intelligence Center.
 *
 * Reads the stored deadline prediction and risk rows (written by predictDeadline /
 * analyzeRisks) and serves them as one payload: delay probability, predicted finish,
 * confidence, driver baselines, feature importances and recommended actions.
 * Every number is deterministic; no AI call is made here.
 */
export class DelayPredictionService {
  private readonly logName = 'delay_prediction_service';

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  private static readonly LEVEL_TO_DELAY: Record<string, number> = { CRITICAL: 85, HIGH: 65, MEDIUM: 40, LOW: 15 };
  private static readonly LEVEL_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

  /*
   * @Function: getDelayPrediction
   * @Description: Baseline delay prediction plus the driver baselines the simulator starts from.
   */
  public async getDelayPrediction(projectId: string): Promise<IServiceResult> {
    try {
      const context = await this._context(projectId);
      if ('error' in context) return global.Helpers.makeBadServiceStatus(context.error);
      return global.Helpers.makeSuccessServiceStatus('Delay prediction fetched.', this._payload(context));
    } catch (err: any) {
      this.log('getDelayPrediction', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Function: simulateDelayPrediction
   * @Description: What-if scenario. Applies the four drivers to the baseline probability
   *   and shifts the predicted finish date accordingly. Stores nothing.
   */
  public async simulateDelayPrediction(projectId: string, body: any): Promise<IServiceResult> {
    try {
      const context = await this._context(projectId);
      if ('error' in context) return global.Helpers.makeBadServiceStatus(context.error);

      const drivers: Partial<DriverInput> = {};
      for (const key of Object.keys(DRIVER_SENSITIVITY) as DriverKey[]) {
        const raw = body?.[key];
        if (raw === undefined || raw === null || raw === '') continue;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) {
          return global.Helpers.makeBadServiceStatus(`${key} must be a number of 0 or more.`);
        }
        drivers[key] = value;
      }
      if (!Object.keys(drivers).length) {
        return global.Helpers.makeBadServiceStatus(`Provide at least one driver: ${Object.keys(DRIVER_SENSITIVITY).join(', ')}.`);
      }

      const base = this._payload(context);
      // A driver left out of the request keeps its baseline, or 0 when there is no baseline.
      const resolved = Object.fromEntries((Object.keys(DRIVER_SENSITIVITY) as DriverKey[]).map(key => [
        key, drivers[key] ?? base.drivers[key].baseline ?? (key === 'qa_capacity_percent' ? 100 : 0),
      ])) as DriverInput;
      const baselineValues = Object.fromEntries((Object.keys(DRIVER_SENSITIVITY) as DriverKey[])
        .map(key => [key, base.drivers[key].baseline])) as Partial<DriverInput>;

      const scenario = computeDelayProbability(base.delay_probability, resolved, baselineValues);
      const finish = shiftFinishDate(
        context.predictedDate, context.remainingWorkingDays, base.delay_probability, scenario.probability,
      );
      this.log('simulateDelayPrediction', JSON.stringify({ projectId, drivers: resolved, probability: scenario.probability }));

      return global.Helpers.makeSuccessServiceStatus('Scenario simulated.', {
        project_id: projectId,
        model_version: DELAY_MODEL_VERSION,
        baseline: {
          delay_probability: base.delay_probability,
          predicted_finish_date: base.predicted_finish_date,
          confidence: base.confidence,
        },
        scenario: {
          drivers: resolved,
          delay_probability: scenario.probability,
          delta_points: round1(scenario.probability - base.delay_probability),
          predicted_finish_date: finish.date,
          shifted_working_days: finish.shifted_working_days,
          verdict: scenario.probability > 70 ? 'HIGH_DELAY_RISK' : scenario.probability > 40 ? 'MODERATE_RISK' : 'ON_SCHEDULE',
        },
        contributions: scenario.contributions,
        confidence: base.confidence,
        reasons: base.reasons,
      });
    } catch (err: any) {
      this.log('simulateDelayPrediction', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /** Stored prediction + risk rows + the driver evidence, loaded once. */
  private async _context(projectId: string) {
    const db = global.db.connection.db!;
    if (!mongoose.Types.ObjectId.isValid(projectId)) return { error: 'Project not found.' as const };
    const project = await db.collection('projects').findOne({ _id: new mongoose.Types.ObjectId(projectId), is_deleted: false });
    if (!project) return { error: 'Project not found.' as const };

    const [prediction, risks, prs, sprints, members] = await Promise.all([
      db.collection('risk_predictions').findOne({ project_id: projectId, kind: 'prediction', risk_key: 'deadline', is_deleted: false }),
      db.collection('risk_predictions').find({ project_id: projectId, kind: 'risk', is_deleted: false })
        .project({ risk_key: 1, risk_level: 1, summary: 1, mitigation: 1, confidence_score: 1, factors: 1, created_at: 1 }).toArray(),
      db.collection('pull_requests').find({ project_id: projectId, is_deleted: { $ne: true } })
        .project({ created_at: 1, merged_at: 1, status: 1 }).toArray(),
      db.collection('sprints').find({ project_id: projectId, is_deleted: { $ne: true } })
        .project({ planned_points: 1, completed_points: 1, status: 1 }).toArray(),
      db.collection('project_members').find({ project_id: projectId, is_deleted: { $ne: true } }).project({ role: 1 }).toArray(),
    ]);

    const forecast: any = prediction?.forecast || null;
    const predictedDate = prediction?.predicted_date ? new Date(prediction.predicted_date) : null;
    return {
      project, prediction, risks, prs, sprints, members, forecast,
      predictedDate: predictedDate && !Number.isNaN(predictedDate.getTime()) ? predictedDate : null,
      remainingWorkingDays: forecast?.deterministic?.predicted_remaining_working_days_rounded ?? null,
    };
  }

  /** The baseline payload the page renders, shared by both endpoints. */
  private _payload(context: any) {
    const { prediction, risks, prs, sprints, members, forecast } = context;
    const ranked = [...risks].sort((a: any, b: any) =>
      (DelayPredictionService.LEVEL_ORDER[a.risk_level] ?? 4) - (DelayPredictionService.LEVEL_ORDER[b.risk_level] ?? 4));

    // Delay probability: the forecast's own on-time probability when it exists,
    // otherwise the stored risk level, which is always present.
    const onTime = prediction?.on_time_probability;
    const hasOnTime = typeof onTime === 'number';
    const level = String(prediction?.risk_level || ranked[0]?.risk_level || 'MEDIUM').toUpperCase();
    const delayProbability = hasOnTime
      ? round1((1 - onTime) * 100)
      : DelayPredictionService.LEVEL_TO_DELAY[level] ?? 40;

    // Confidence: the forecast's data-quality score, which is a real coverage figure.
    const dataQuality = forecast?.data_quality?.score ?? null;
    const confidence = hasOnTime ? Math.round((dataQuality ?? 50)) : dataQuality !== null ? Math.round(dataQuality * 0.6) : 30;

    const reasons: string[] = [];
    if (!prediction) reasons.push('NO_STORED_PREDICTION');
    if (!hasOnTime) reasons.push(`PROBABILITY_FROM_RISK_LEVEL:${level}`);
    if (forecast?.probability?.reason) reasons.push(String(forecast.probability.reason));

    // ---- driver baselines: real value, or null with the reason it cannot be measured
    const merged = prs.filter((pr: any) => pr.merged_at && pr.created_at);
    const latencyHours = merged.length
      ? round1(merged.reduce((sum: number, pr: any) =>
        sum + (new Date(pr.merged_at).getTime() - new Date(pr.created_at).getTime()) / 3600000, 0) / merged.length)
      : null;

    const planned = sprints.reduce((sum: number, s: any) => sum + (Number(s.planned_points) || 0), 0);
    const completed = sprints.reduce((sum: number, s: any) => sum + (Number(s.completed_points) || 0), 0);
    const required = forecast?.deterministic?.required_velocity_per_working_day ?? null;
    const actual = forecast?.velocity?.per_working_day ?? null;
    let deficit: number | null = null;
    let deficitBasis = 'NO_VELOCITY_DATA';
    if (planned > 0) {
      deficit = round1(Math.max(0, 100 - (completed / planned) * 100));
      deficitBasis = 'SPRINT_POINTS';
    } else if (typeof required === 'number' && required > 0 && typeof actual === 'number') {
      deficit = round1(clamp100(100 - (actual / required) * 100));
      deficitBasis = 'REQUIRED_VS_OBSERVED_VELOCITY';
    }

    const qaCount = members.filter((row: any) => /qa|test/i.test(String(row.role || ''))).length;

    const drivers = {
      pr_review_latency_hours: {
        baseline: latencyHours,
        source: latencyHours === null ? null : `${merged.length} merged pull requests`,
        reason: latencyHours === null ? 'NO_MERGED_PULL_REQUESTS' : null,
      },
      sprint_velocity_deficit_percent: {
        baseline: deficit,
        source: deficit === null ? null : deficitBasis,
        reason: deficit === null ? deficitBasis : null,
      },
      critical_bugs: {
        // No severity field on work items and no Taiga tag/priority mirror: this is a
        // what-if input only, never a measured baseline.
        baseline: null,
        source: null,
        reason: 'NO_BUG_SEVERITY_TRACKED',
      },
      qa_capacity_percent: {
        baseline: qaCount > 0 && members.length ? round1((qaCount / members.length) * 100) : null,
        source: qaCount > 0 ? `${qaCount} of ${members.length} members` : null,
        reason: qaCount > 0 ? null : 'NO_QA_ROLE_ON_PROJECT',
      },
    };

    // ---- explainable drivers + actions, from the stored risk rows and forecast flags
    const featureImportances = [
      ...(forecast?.flags || []).map((flag: string) => ({
        feature: flag, weight: flag === 'OVERDUE' || flag === 'PREDICTED_LATE' ? 80 : 60,
        description: `Delivery forecast flag: ${flag}.`, source: 'forecast',
      })),
      ...ranked.slice(0, 6).map((row: any) => ({
        feature: row.risk_key,
        weight: DelayPredictionService.LEVEL_TO_DELAY[String(row.risk_level).toUpperCase()] ?? 40,
        description: row.summary || '',
        source: 'risk',
      })),
    ].slice(0, 8);

    const recommendations = ranked
      .map((row: any) => row.mitigation)
      .filter((text: any): text is string => typeof text === 'string' && text.trim().length > 0)
      .slice(0, 6);

    return {
      project_id: String(context.project._id),
      project_name: context.project.name,
      model_version: DELAY_MODEL_VERSION,
      generated_at: prediction?.generated_at || prediction?.updated_at || null,
      delay_probability: delayProbability,
      verdict: delayProbability > 70 ? 'HIGH_DELAY_RISK' : delayProbability > 40 ? 'MODERATE_RISK' : 'ON_SCHEDULE',
      predicted_finish_date: context.predictedDate ? context.predictedDate.toISOString().slice(0, 10) : null,
      target_date: prediction?.target_date ? new Date(prediction.target_date).toISOString().slice(0, 10) : null,
      remaining_working_days: context.remainingWorkingDays,
      confidence,
      confidence_basis: hasOnTime ? 'FORECAST_DATA_QUALITY' : 'RISK_LEVEL_FALLBACK',
      on_time_probability: hasOnTime ? onTime : null,
      risk_level: level,
      drivers,
      sensitivity: DRIVER_SENSITIVITY,
      feature_importances: featureImportances,
      recommendations,
      risk_counts: risks.reduce((acc: Record<string, number>, row: any) => {
        acc[row.risk_level] = (acc[row.risk_level] || 0) + 1;
        return acc;
      }, {}),
      reasons,
    };
  }
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const clamp100 = (value: number): number => Math.max(0, Math.min(100, value));
