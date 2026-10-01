import { createHash } from 'crypto';

// Rule book §11–15: observed-delivery model on a count basis, deterministic slack,
// gated seeded simulation, and a data-quality score kept separate from probability.
export const DEADLINE_MODEL_VERSION = 'deadline-rules-v1:observed-count';
export const WINDOW_WORKING_DAYS = 20;
export const MIN_WEEKLY_BLOCKS = 8;
export const MIN_ACCEPTED_ITEMS = 20;
export const SIMULATION_RUNS = 10000;
export const HORIZON_WEEKS = 104;

const DAY_MS = 86400000;

export interface DeadlineForecastInput {
  projectId: string;
  asOf: Date;
  rulesVersion: string;
  totalItems: number;
  remainingItems: number;
  /** Items with explicit progress or completion evidence. */
  startedItems?: number;
  acceptedDates: Date[];
  firstItemCreatedAt: Date | null;
  targetDate: Date | null;
  targetSource: string | null;
  sources: { name: string; lastSyncAt: Date | null }[];
  workUnit: 'TAIGA_TASK_COUNT' | 'WORK_ITEM_COUNT';
  acceptanceDateBasis: string;
}

export const startOfUtcDay = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const isWorkingDay = (d: Date): boolean => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
const isoDay = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const round = (value: number, digits = 2): number => Math.round(value * 10 ** digits) / 10 ** digits;

/** The nth working day after `from` (from itself excluded). */
export function addWorkingDays(from: Date, n: number): Date {
  let day = startOfUtcDay(from);
  let added = 0;
  while (added < n) {
    day = new Date(day.getTime() + DAY_MS);
    if (isWorkingDay(day)) added++;
  }
  return day;
}

/** Working days after `fromExclusive` up to and including `toInclusive`; 0 when the target is not after the snapshot. */
export function workingDaysBetween(fromExclusive: Date, toInclusive: Date): number {
  const end = startOfUtcDay(toInclusive).getTime();
  let day = startOfUtcDay(fromExclusive).getTime() + DAY_MS;
  let count = 0;
  for (; day <= end; day += DAY_MS) if (isWorkingDay(new Date(day))) count++;
  return count;
}

const isoWeekStart = (d: Date): Date => {
  const day = startOfUtcDay(d);
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * DAY_MS);
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export function computeDeadlineForecast(input: DeadlineForecastInput) {
  const asOfDay = startOfUtcDay(input.asOf);
  const asOfEnd = asOfDay.getTime() + DAY_MS - 1;
  const targetDay = input.targetDate ? startOfUtcDay(input.targetDate) : null;
  const accepted = input.acceptedDates.filter(date => date.getTime() <= asOfEnd).sort((a, b) => a.getTime() - b.getTime());
  const remaining = Math.max(0, input.remainingItems);
  const flags: string[] = [];
  const reasons: string[] = [];

  // Observed velocity over the last 20 working days (fewer when the project is younger), zero days included.
  const firstDay = input.firstItemCreatedAt ? startOfUtcDay(input.firstItemCreatedAt) : null;
  const windowDays: Date[] = [];
  for (let day = asOfDay; windowDays.length < WINDOW_WORKING_DAYS; day = new Date(day.getTime() - DAY_MS)) {
    if (firstDay && day < firstDay) break;
    if (isWorkingDay(day)) windowDays.push(day);
  }
  const windowStart = windowDays.length ? windowDays[windowDays.length - 1].getTime() : asOfDay.getTime();
  const acceptedInWindow = accepted.filter(date => date.getTime() >= windowStart).length;
  const velocity = windowDays.length ? acceptedInWindow / windowDays.length : 0;
  if (windowDays.length < WINDOW_WORKING_DAYS) reasons.push('SHORT_HISTORY_WINDOW');

  const started = Math.max(0, input.startedItems ?? accepted.length);
  let status: 'complete' | 'not_started' | 'forecast' | 'stalled' | 'insufficient_data';
  let predictedRemainingDays: number | null = null;
  let roundedDays: number | null = null;
  let predictedFinish: Date | null = null;
  if (input.totalItems === 0) {
    status = 'insufficient_data';
    reasons.push('NO_COMMITTED_SCOPE');
  } else if (remaining === 0) {
    status = 'complete';
    reasons.push('PROJECT_ALREADY_COMPLETE');
  } else if (started === 0) {
    status = 'not_started';
    reasons.push('PROJECT_NOT_STARTED');
  } else if (velocity === 0) {
    status = 'stalled';
    flags.push('ZERO_THROUGHPUT');
  } else {
    status = 'forecast';
    predictedRemainingDays = remaining / velocity;
    roundedDays = Math.ceil(predictedRemainingDays);
    predictedFinish = addWorkingDays(asOfDay, roundedDays);
  }

  // Deterministic feasibility (§13).
  if (!targetDay) reasons.push('NO_TARGET_DATE');
  const targetPassed = Boolean(targetDay && targetDay < asOfDay);
  const availableDays = targetDay ? workingDaysBetween(asOfDay, targetDay) : null;
  if (targetPassed && remaining > 0) flags.push('OVERDUE');
  if (targetDay && predictedFinish && predictedFinish > targetDay) flags.push('PREDICTED_LATE');
  if (targetDay && status === 'stalled') flags.push('PREDICTED_LATE');

  // Weekly accepted-throughput blocks for the empirical simulation (§14).
  const weeklyBlocks: number[] = [];
  if (firstDay) {
    const lastCompleteWeek = isoWeekStart(asOfDay).getTime();
    for (let week = isoWeekStart(firstDay).getTime(); week < lastCompleteWeek; week += 7 * DAY_MS) {
      weeklyBlocks.push(accepted.filter(date => date.getTime() >= week && date.getTime() < week + 7 * DAY_MS).length);
    }
  }
  const acceptedInBlocks = weeklyBlocks.reduce((sum, count) => sum + count, 0);

  const canonical = JSON.stringify({
    projectId: input.projectId, asOf: isoDay(asOfDay), model: DEADLINE_MODEL_VERSION, rules: input.rulesVersion,
    workUnit: input.workUnit, acceptanceDateBasis: input.acceptanceDateBasis, targetSource: input.targetSource,
    totalItems: input.totalItems, remaining, accepted: accepted.map(date => date.toISOString()),
    firstItemCreatedAt: input.firstItemCreatedAt?.toISOString() || null, target: isoDay(targetDay),
    sources: input.sources.map(source => ({ name: source.name, lastSyncAt: source.lastSyncAt?.toISOString() || null })),
  });
  const forecastKey = sha256(canonical);

  let onTime: number | null = null;
  let percentiles: Record<'p10' | 'p50' | 'p80' | 'p90', string | null> = { p10: null, p50: null, p80: null, p90: null };
  let simulation: Record<string, unknown> | null = null;
  let probabilityReason: string | null = null;

  if (status === 'complete') {
    onTime = targetDay ? (targetPassed ? null : 1) : null;
    if (targetPassed) probabilityReason = 'COMPLETE_ACTUAL_FINISH_DECIDES';
  } else if (targetPassed && remaining > 0) {
    onTime = 0;
  } else if (!targetDay) {
    probabilityReason = 'NO_TARGET_DATE';
  } else if (status === 'not_started') {
    probabilityReason = 'PROJECT_NOT_STARTED';
  } else if (status !== 'forecast' && status !== 'stalled') {
    probabilityReason = reasons[0] || 'INSUFFICIENT_DATA';
  } else if (weeklyBlocks.length < MIN_WEEKLY_BLOCKS || accepted.length < MIN_ACCEPTED_ITEMS || acceptedInBlocks === 0) {
    probabilityReason = 'NO_REPRESENTATIVE_HISTORY';
  } else {
    const seed = parseInt(sha256(`${forecastKey}:seed`).slice(0, 8), 16);
    const random = mulberry32(seed);
    const finishes: number[] = [];
    let censored = 0;
    for (let run = 0; run < SIMULATION_RUNS; run++) {
      let done = 0;
      let weeks = 0;
      while (done < remaining && weeks < HORIZON_WEEKS) {
        done += weeklyBlocks[Math.floor(random() * weeklyBlocks.length)];
        weeks++;
      }
      if (done < remaining) {
        censored++;
        finishes.push(Number.POSITIVE_INFINITY);
      } else {
        finishes.push(addWorkingDays(asOfDay, weeks * 5).getTime());
      }
    }
    finishes.sort((a, b) => a - b);
    const targetMs = targetDay!.getTime();
    onTime = round(finishes.filter(finish => finish <= targetMs).length / SIMULATION_RUNS, 4);
    const pct = (p: number): string => {
      const value = finishes[Math.min(SIMULATION_RUNS - 1, Math.floor(p * SIMULATION_RUNS))];
      return Number.isFinite(value) ? new Date(value).toISOString().slice(0, 10) : 'BEYOND_HORIZON';
    };
    percentiles = { p10: pct(0.1), p50: pct(0.5), p80: pct(0.8), p90: pct(0.9) };
    simulation = {
      runs: SIMULATION_RUNS, seed, horizon_weeks: HORIZON_WEEKS, weekly_blocks: weeklyBlocks.length,
      accepted_in_blocks: acceptedInBlocks, censored_runs: censored, assumes_fixed_scope: true,
    };
  }
  if (onTime !== null && onTime < 0.4) flags.push('HIGH_DEADLINE_RISK');

  // Data quality (§15), renormalised over applicable components; acceptance evidence is not tracked yet.
  const freshnessWindowMs = 24 * 60 * 60 * 1000;
  const components: Record<string, { value: number | null; weight: number; basis: string }> = {
    estimate_coverage: { value: input.totalItems > 0 ? 1 : null, weight: 0.3, basis: 'ITEM_COUNT' },
    acceptance_evidence_coverage: { value: null, weight: 0.3, basis: 'UNKNOWN_NOT_TRACKED' },
    required_source_freshness: {
      value: input.sources.length
        ? input.sources.filter(source => source.lastSyncAt && asOfEnd - source.lastSyncAt.getTime() <= freshnessWindowMs).length / input.sources.length
        : null,
      weight: 0.2, basis: 'SYNC_WITHIN_24H',
    },
    history_sufficiency: { value: Math.min(1, weeklyBlocks.length / MIN_WEEKLY_BLOCKS), weight: 0.2, basis: 'WEEKLY_BLOCKS_OVER_8' },
  };
  const applicable = Object.values(components).filter(component => component.value !== null);
  const coverage = applicable.reduce((sum, component) => sum + component.weight, 0);
  const dataQuality = coverage
    ? round(100 * applicable.reduce((sum, component) => sum + component.weight * (component.value as number), 0) / coverage, 1)
    : null;

  let riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  if (status === 'complete') riskLevel = 'LOW';
  else if (flags.includes('OVERDUE')) riskLevel = 'CRITICAL';
  else if (onTime !== null && onTime < 0.2) riskLevel = 'CRITICAL';
  else if (flags.includes('PREDICTED_LATE') || flags.includes('ZERO_THROUGHPUT') || flags.includes('HIGH_DEADLINE_RISK')) riskLevel = 'HIGH';
  else if (status === 'not_started' || status === 'insufficient_data' || !targetDay) riskLevel = 'MEDIUM';
  else if (onTime !== null) riskLevel = onTime < 0.8 ? 'MEDIUM' : 'LOW';
  else riskLevel = availableDays !== null && roundedDays !== null && availableDays - roundedDays <= 2 ? 'MEDIUM' : 'LOW';

  return {
    model_version: DEADLINE_MODEL_VERSION,
    rules_version: input.rulesVersion,
    forecast_key: forecastKey,
    as_of: isoDay(asOfDay),
    calendar: { timezone: 'UTC', working_days: 'MON_FRI', holidays: 'NONE_CONFIGURED' },
    work_unit: input.workUnit,
    basis: 'COUNT_BASED',
    acceptance_date_basis: input.acceptanceDateBasis,
    target_source: input.targetSource,
    status,
    scope: { total_items: input.totalItems, remaining_items: remaining, started_items: started, accepted_items: accepted.length, remaining_basis: 'OPEN_ITEM_COUNT' },
    velocity: {
      model: 'OBSERVED_DELIVERY',
      window_working_days: windowDays.length,
      accepted_in_window: acceptedInWindow,
      per_working_day: round(velocity, 3),
    },
    deterministic: {
      predicted_remaining_working_days: predictedRemainingDays === null ? null : round(predictedRemainingDays, 2),
      predicted_remaining_working_days_rounded: roundedDays,
      predicted_finish_date: isoDay(predictedFinish),
      target_date: isoDay(targetDay),
      available_working_days: availableDays,
      required_velocity_per_working_day: availableDays && availableDays > 0 ? round(remaining / availableDays, 3) : null,
      slack_working_days: availableDays !== null && roundedDays !== null ? availableDays - roundedDays : null,
      capacity_ratio: availableDays !== null && predictedRemainingDays ? round(availableDays / predictedRemainingDays, 2) : null,
      dependencies: 'UNKNOWN_DEPENDENCIES',
      accuracy_label: 'APPROXIMATE',
    },
    probability: {
      on_time: onTime,
      ...percentiles,
      reason: probabilityReason,
      calibration: 'UNCALIBRATED',
      simulation,
    },
    data_quality: { label: 'DATA_QUALITY_SCORE', score: dataQuality, coverage_weight: round(coverage, 2), components },
    flags: [...new Set(flags)],
    reasons: [...new Set(reasons)],
    risk_level: riskLevel,
  };
}

export type DeadlineForecast = ReturnType<typeof computeDeadlineForecast>;
