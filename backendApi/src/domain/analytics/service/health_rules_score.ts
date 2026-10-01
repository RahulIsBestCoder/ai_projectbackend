import { Types } from 'mongoose';
import { IServiceResult } from '../../../helper/common_interface';
import { loadScoringRules } from '../../ai_intelligence/service/scoring_rules';
import { DeadlineForecastInput, computeDeadlineForecast, startOfUtcDay } from '../../risk_prediction/service/deadline_forecast';

/**
 * Rule-book health score (docs/project_health_scoring_rules.md §5-§16), calculated
 * from delivery data with no AI call. Computed on request only — this module never
 * writes analytics snapshots, so it cannot shadow the AI assessment's health rows.
 */
export const HEALTH_RULES_VERSION = 'health-rules-v1';
export const HEALTH_MIN_COVERAGE = 0.7;
export const HEALTH_SECTION_WEIGHTS = { feature: 0.3, tasks: 0.2, sprint: 0.2, efficiency: 0.15, evidence: 0.1, deadline: 0.05 };
const EVIDENCE_WINDOW_WORKING_DAYS = 10;
const COMMIT_WINDOW_DAYS = 30;
const DAY_MS = 86400000;

type SectionKey = keyof typeof HEALTH_SECTION_WEIGHTS;

export interface HealthItem { closed: boolean; acceptedAt: Date | null; createdAt: Date | null; dueAt: Date | null; sprintKey: string | null }
export interface HealthSprint { key: string | null; endDate: Date | null; plannedPoints: number; completedPoints: number }
export interface HealthInputs {
  items: HealthItem[];
  sprints: HealthSprint[];
  plan: { accepted: boolean; sprints: { endDate: Date | null; taskCount: number }[] } | null;
  commitDates: Date[];
  hasRepository: boolean;
  forecast: Omit<DeadlineForecastInput, 'asOf' | 'totalItems' | 'remainingItems' | 'acceptedDates'>;
  /**
   * Shared completion truth. When an accepted plan checklist exists, a user's tick
   * IS delivery and drives the feature section; otherwise the source items do.
   */
  checklist?: { available: boolean; total: number; completed: number; completedAt: (Date | null)[] } | null;
}
export interface HealthSection { score: number | null; weight: number; basis: string; reason: string | null; numerator?: number; denominator?: number }

const round = (value: number, digits = 1): number => Math.round(value * 10 ** digits) / 10 ** digits;
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const endOfDay = (d: Date): number => startOfUtcDay(d).getTime() + DAY_MS - 1;
const toDate = (value: any): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Health for one moment, using only evidence dated on or before `asOf`. */
export function computeHealthScore(inputs: HealthInputs, asOf: Date, isToday: boolean) {
  const dayEnd = endOfDay(asOf);
  const inScope = inputs.items.filter(item => !item.createdAt || item.createdAt.getTime() <= dayEnd);
  // Undated closures are only trusted for today, never for a past day.
  const closedBy = (item: HealthItem, limit: number): boolean =>
    item.closed && (item.acceptedAt ? item.acceptedAt.getTime() <= limit : isToday && limit >= dayEnd);
  const closedItems = inScope.filter(item => closedBy(item, dayEnd));
  const sprintEnd = new Map(inputs.sprints.filter(s => s.key && s.endDate).map(s => [s.key as string, s.endDate as Date]));

  const section = (key: SectionKey, score: number | null, basis: string, reason: string | null, counts: { numerator?: number; denominator?: number } = {}): HealthSection =>
    ({ score: score === null ? null : round(Math.max(0, Math.min(100, score))), weight: HEALTH_SECTION_WEIGHTS[key], basis, reason: score === null ? reason : null, ...counts });

  // §6 Feature delivery vs plan: work done vs the share the plan has due by now.
  const planSprints = (inputs.plan?.sprints || []).filter(s => s.endDate);
  const byTasks = planSprints.some(s => s.taskCount > 0);
  const planWeight = (s: { taskCount: number }) => (byTasks ? s.taskCount : 1);
  const planTotal = planSprints.reduce((sum, s) => sum + planWeight(s), 0);
  const planDue = planSprints.filter(s => (s.endDate as Date).getTime() <= dayEnd).reduce((sum, s) => sum + planWeight(s), 0);
  // A user's tick IS delivery (product rule), so when the checklist exists it decides
  // this section; the plan-schedule comparison is the fallback for projects without one.
  const checklist = inputs.checklist;
  let feature: HealthSection;
  if (checklist?.available && checklist.total > 0) {
    const done = checklist.completedAt.filter(date => (date ? date.getTime() <= dayEnd : isToday)).length;
    feature = section('feature', 100 * done / checklist.total, 'PLAN_CHECKLIST_TICKED', null,
      { numerator: done, denominator: checklist.total });
  } else if (!planTotal) {
    feature = section('feature', null, 'PLAN_SPRINT_SHARE', 'NO_PLAN');
  } else if (!inScope.length) {
    feature = section('feature', null, 'PLAN_SPRINT_SHARE', 'NO_COMMITTED_SCOPE');
  } else if (!planDue) {
    feature = section('feature', null, 'PLAN_SPRINT_SHARE', 'NOT_DUE');
  } else {
    feature = section('feature', 100 * (closedItems.length / inScope.length) / (planDue / planTotal), 'PLAN_SPRINT_SHARE', null,
      { numerator: closedItems.length, denominator: inScope.length });
  }

  // §7 Task resolution: items due by now (own due date, else their sprint's end) that are closed.
  const due = inScope
    .map(item => ({ item, dueAt: item.dueAt || (item.sprintKey ? sprintEnd.get(item.sprintKey) || null : null) }))
    .filter(row => row.dueAt && (row.dueAt as Date).getTime() <= dayEnd);
  const resolved = due.filter(row => closedBy(row.item, dayEnd)).length;
  const tasks = due.length
    ? section('tasks', 100 * resolved / due.length, 'DUE_DATE_OR_SPRINT_END', null, { numerator: resolved, denominator: due.length })
    : section('tasks', null, 'DUE_DATE_OR_SPRINT_END', inScope.some(item => item.dueAt || item.sprintKey) ? 'NOT_DUE' : 'NO_DUE_DATES');

  // §8 Sprint completion by planned date: per ended sprint, work closed by its end date.
  const ended = inputs.sprints.filter(s => s.endDate && s.endDate.getTime() <= dayEnd);
  const ratios: number[] = [];
  for (const sprint of ended) {
    const limit = endOfDay(sprint.endDate as Date);
    const linked = sprint.key ? inputs.items.filter(item => item.sprintKey === sprint.key) : [];
    if (linked.length) ratios.push(linked.filter(item => closedBy(item, limit)).length / linked.length);
    else if (sprint.plannedPoints > 0) ratios.push(Math.min(sprint.completedPoints, sprint.plannedPoints) / sprint.plannedPoints);
  }
  const sprint = ratios.length
    ? section('sprint', 100 * ratios.reduce((sum, r) => sum + r, 0) / ratios.length, 'CLOSED_BY_SPRINT_END', null, { denominator: ratios.length })
    : section('sprint', null, 'CLOSED_BY_SPRINT_END', ended.length ? 'NO_SPRINT_COMMITMENT' : 'NOT_DUE');

  // §9 Efficiency needs actual hours, which are not tracked.
  const efficiency = section('efficiency', null, 'ACTUAL_VS_ESTIMATED_HOURS', 'MISSING_ACTUAL_HOURS');

  // §10 Implementation evidence (proxy): working days with commits in the last 10 working days.
  let evidence: HealthSection;
  if (!inputs.hasRepository) {
    evidence = section('evidence', null, 'COMMIT_DAYS_LAST_10_WORKING_DAYS', 'NO_REPOSITORY_DATA');
  } else {
    const commitDays = new Set(inputs.commitDates.filter(d => d.getTime() <= dayEnd).map(isoDay));
    const windowDays: string[] = [];
    for (let day = startOfUtcDay(asOf); windowDays.length < EVIDENCE_WINDOW_WORKING_DAYS; day = new Date(day.getTime() - DAY_MS)) {
      if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) windowDays.push(isoDay(day));
    }
    const active = windowDays.filter(day => commitDays.has(day)).length;
    evidence = section('evidence', 100 * active / windowDays.length, 'COMMIT_DAYS_LAST_10_WORKING_DAYS', null, { numerator: active, denominator: windowDays.length });
  }

  // §14 Deadline feasibility: the simulated on-time probability.
  const fc = computeDeadlineForecast({
    ...inputs.forecast, asOf, totalItems: inScope.length, remainingItems: inScope.length - closedItems.length,
    acceptedDates: closedItems.filter(item => item.acceptedAt).map(item => item.acceptedAt as Date),
  });
  const deadline = fc.probability.on_time === null
    ? section('deadline', null, 'ON_TIME_PROBABILITY', fc.probability.reason || 'NO_PROBABILITY')
    : section('deadline', 100 * fc.probability.on_time, 'ON_TIME_PROBABILITY', null);

  const sections: Record<SectionKey, HealthSection> = { feature, tasks, sprint, efficiency, evidence, deadline };
  const available = Object.values(sections).filter(s => s.score !== null);
  const coverage = round(available.reduce((sum, s) => sum + s.weight, 0), 2);
  const reasons = Object.entries(sections).filter(([, s]) => s.reason).map(([key, s]) => `${key.toUpperCase()}:${s.reason}`);
  if (inputs.plan && !inputs.plan.accepted) reasons.push('FEATURE:PLAN_NOT_ACCEPTED');

  // Weighted average over whatever scored, renormalised by its coverage.
  const weighted = available.length
    ? round(available.reduce((sum, s) => sum + s.weight * (s.score as number), 0) / coverage)
    : null;
  const bandOf = (value: number | null): string =>
    value === null ? 'N/A' : value < 40 ? 'LOW' : value < 70 ? 'AVERAGE' : 'HIGH';

  // §16: publish `score` only with enough section coverage, feature and sprint included.
  // `provisional_score` is the same average without that gate — show it labelled, never as final.
  let score: number | null = null;
  let status: 'FINAL' | 'PROVISIONAL' | 'INSUFFICIENT_DATA' = 'INSUFFICIENT_DATA';
  if (coverage >= HEALTH_MIN_COVERAGE && feature.score !== null && sprint.score !== null) {
    score = weighted;
    status = available.length === Object.keys(sections).length ? 'FINAL' : 'PROVISIONAL';
  }

  return {
    score, status, band: bandOf(score),
    provisional_score: weighted, provisional_band: bandOf(weighted),
    coverage_weight: coverage, min_coverage: HEALTH_MIN_COVERAGE,
    sections, reasons, delivery_flags: fc.flags, work_unit: fc.work_unit,
  };
}

export class HealthRulesService {
  private readonly logName = 'health_rules_score';

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  /*
   * @Function: getRulesHealth
   * @Description: Today's rule-book health score for the health section. Read-only.
   */
  public async getRulesHealth(projectId: string): Promise<IServiceResult> {
    try {
      const db = global.db.connection.db!;
      if (!Types.ObjectId.isValid(projectId)) return global.Helpers.makeBadServiceStatus('Project not found.');
      const project = await db.collection('projects').findOne({ _id: new Types.ObjectId(projectId), is_deleted: { $ne: true } });
      if (!project) return global.Helpers.makeBadServiceStatus('Project not found.');

      const now = new Date();
      const inputs = await this._loadInputs(db, projectId, project, new Date(now.getTime() - COMMIT_WINDOW_DAYS * DAY_MS));
      const result = computeHealthScore(inputs, now, true);
      this.log('getRulesHealth', JSON.stringify({ projectId, score: result.score, status: result.status }));

      return global.Helpers.makeSuccessServiceStatus('Rule-based health calculated.', {
        project: { _id: project._id, name: project.name },
        as_of: isoDay(now),
        calculation_version: HEALTH_RULES_VERSION,
        rules_version: inputs.forecast.rulesVersion,
        value: result.score,
        band: result.band,
        status: result.status,
        provisional_score: result.provisional_score,
        provisional_band: result.provisional_band,
        coverage_weight: result.coverage_weight,
        min_coverage: result.min_coverage,
        work_unit: result.work_unit,
        sections: result.sections,
        reasons: result.reasons,
        delivery_flags: result.delivery_flags,
        weights: HEALTH_SECTION_WEIGHTS,
      });
    } catch (err: any) {
      this.log('getRulesHealth', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /** Count-based inputs: Taiga tasks when synced, otherwise project work items. */
  private async _loadInputs(db: any, projectId: string, project: any, commitsSince: Date): Promise<HealthInputs> {
    const filter = { project_id: projectId, is_deleted: { $ne: true } };
    const [taigaRows, sprintRows, plans, commits, integrations] = await Promise.all([
      db.collection('taiga_tasks').find({ ...filter, taiga_task_id: { $exists: true, $ne: null } })
        .project({ is_closed: 1, finished_date: 1, created_date: 1, due_date: 1, taiga_milestone_id: 1 }).toArray(),
      db.collection('sprints').find(filter).project({ end_date: 1, planned_points: 1, completed_points: 1, taiga_milestone_id: 1 }).toArray(),
      db.collection('ai_plans').find(filter).project({ status: 1, 'plan.sprints': 1, 'plan.deadlines': 1, updated_at: 1, created_at: 1 }).toArray(),
      db.collection('commits').find({ ...filter, committed_at: { $gte: commitsSince } }).project({ committed_at: 1 }).toArray(),
      db.collection('integrations').find({ ...filter, provider: { $in: ['github', 'taiga'] } })
        .project({ provider: 1, repository_name: 1, last_sync_at: 1 }).toArray(),
    ]);

    const taiga = taigaRows.length > 0;
    let items: HealthItem[];
    let acceptanceDateBasis: string;
    if (taiga) {
      acceptanceDateBasis = 'TAIGA_FINISHED_DATE';
      items = taigaRows.map((row: any) => ({
        closed: !!row.is_closed, acceptedAt: toDate(row.finished_date), createdAt: toDate(row.created_date),
        dueAt: toDate(row.due_date), sprintKey: row.taiga_milestone_id != null ? String(row.taiga_milestone_id) : null,
      }));
    } else {
      acceptanceDateBasis = 'WORK_ITEM_COMPLETED_AT_OR_UPDATED_AT';
      const workItems = await db.collection('work_items').find(filter)
        .project({ status: 1, completed_at: 1, updated_at: 1, created_at: 1, due_date: 1, sprint_id: 1 }).toArray();
      items = workItems.map((item: any) => {
        const closed = ['done', 'completed', 'closed'].includes(String(item.status || '').toLowerCase());
        return {
          closed, acceptedAt: closed ? toDate(item.completed_at || item.updated_at) : null, createdAt: toDate(item.created_at),
          dueAt: toDate(item.due_date), sprintKey: item.sprint_id ? String(item.sprint_id) : null,
        };
      });
    }

    const plan: any = plans.slice().sort((a: any, b: any) =>
      Number(b.status === 'accepted') - Number(a.status === 'accepted')
      || new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())[0];

    // Target date: project field first, then the latest date in the chosen plan.
    let targetDate = toDate(project.target_date) || toDate(project.end_date);
    let targetSource: string | null = toDate(project.target_date) ? 'PROJECT_TARGET_DATE' : targetDate ? 'PROJECT_END_DATE' : null;
    if (!targetDate && plan) {
      const planDates = [
        ...(plan.plan?.deadlines || []).map((row: any) => row?.date),
        ...(plan.plan?.sprints || []).map((row: any) => row?.end_date || row?.deadline),
      ].map(toDate).filter((date): date is Date => date !== null);
      if (planDates.length) {
        targetDate = new Date(Math.max(...planDates.map(date => date.getTime())));
        targetSource = 'LATEST_PLAN_DEADLINE';
      }
    }

    // Shared completion truth: ticked plan items drive the feature section.
    const { resolveCompletion, loadCompletionInputs } =
      require('../../project/service/completion_resolver') as typeof import('../../project/service/completion_resolver');
    const completionInputs = await loadCompletionInputs(db, projectId);
    const truth = resolveCompletion(completionInputs.planItems, completionInputs.sourceItems);
    const checklist = truth.plan_track.available ? {
      available: true,
      total: truth.plan_track.total,
      completed: truth.plan_track.completed,
      completedAt: truth.plan_track.items.filter(item => item.completed).map(item => item.acceptedAt),
    } : null;

    const createdDates = items.map(item => item.createdAt).filter((date): date is Date => date !== null);
    const commitDates = commits.map((row: any) => toDate(row.committed_at)).filter((date: Date | null): date is Date => date !== null);

    return {
      items,
      sprints: sprintRows.map((row: any) => ({
        key: taiga ? (row.taiga_milestone_id != null ? String(row.taiga_milestone_id) : null) : String(row._id),
        endDate: toDate(row.end_date),
        plannedPoints: Number(row.planned_points) || 0,
        completedPoints: Number(row.completed_points) || 0,
      })),
      plan: plan ? {
        accepted: plan.status === 'accepted',
        sprints: (plan.plan?.sprints || []).map((row: any) => ({
          endDate: toDate(row?.end_date || row?.deadline),
          taskCount: Array.isArray(row?.tasks) ? row.tasks.length : 0,
        })),
      } : null,
      commitDates,
      checklist,
      hasRepository: commitDates.length > 0 || integrations.some((row: any) => row.provider === 'github'),
      forecast: {
        projectId,
        rulesVersion: loadScoringRules()?.version || 'unversioned',
        workUnit: taiga ? 'TAIGA_TASK_COUNT' : 'WORK_ITEM_COUNT',
        acceptanceDateBasis,
        firstItemCreatedAt: createdDates.length ? new Date(Math.min(...createdDates.map(date => date.getTime()))) : null,
        targetDate,
        targetSource,
        sources: integrations.map((row: any) => ({
          name: `${row.provider}:${row.repository_name || ''}`,
          lastSyncAt: toDate(row.last_sync_at),
        })),
      },
    };
  }
}
