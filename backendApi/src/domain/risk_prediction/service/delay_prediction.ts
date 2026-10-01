/**
 * Deterministic delivery-delay model for the Predictive Intelligence Center.
 *
 * The baseline probability comes from the stored deadline forecast (rule book §11-§14).
 * The what-if simulator applies documented, bounded sensitivities to four drivers, so
 * moving a slider always moves the number the same way. No AI call, no randomness.
 */

export const DELAY_MODEL_VERSION = 'delay-sensitivity-v1';

/** Weight = percentage points of delay probability at the driver's full adverse range. */
export const DRIVER_SENSITIVITY = {
  pr_review_latency_hours: { max_points: 12, reference: 48, unit: 'hours', label: 'PR review latency' },
  sprint_velocity_deficit_percent: { max_points: 22, reference: 100, unit: 'percent', label: 'Sprint velocity deficit' },
  critical_bugs: { max_points: 14, reference: 10, unit: 'bugs', label: 'Critical bugs' },
  qa_capacity_percent: { max_points: 10, reference: 100, unit: 'percent', label: 'QA capacity' },
};

export type DriverKey = keyof typeof DRIVER_SENSITIVITY;

export interface DriverInput { pr_review_latency_hours: number; sprint_velocity_deficit_percent: number; critical_bugs: number; qa_capacity_percent: number }
export interface DriverContribution { key: DriverKey; label: string; value: number; baseline: number | null; points: number; direction: 'increases' | 'decreases' | 'neutral'; basis: string }

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 1): number => Math.round(value * 10 ** digits) / 10 ** digits;

/** Adverse fraction (0-1) of a driver: how far it sits toward its worst end. */
function adverseFraction(key: DriverKey, value: number): number {
  const { reference } = DRIVER_SENSITIVITY[key];
  // QA capacity is protective: 100% is best, 0% is worst.
  if (key === 'qa_capacity_percent') return clamp((reference - value) / reference, 0, 1);
  return clamp(value / reference, 0, 1);
}

/**
 * Delay probability for a driver set, anchored on the forecast's own probability.
 * `basePercent` is the forecast-derived baseline; drivers move it within 0-98.
 */
/** Reference point for a driver with no measured baseline: its healthy end. */
export const NEUTRAL_DRIVER: Record<DriverKey, number> = {
  pr_review_latency_hours: 0,
  sprint_velocity_deficit_percent: 0,
  critical_bugs: 0,
  qa_capacity_percent: 100,
};

export function computeDelayProbability(basePercent: number, drivers: DriverInput, baseline: Partial<DriverInput>) {
  const contributions: DriverContribution[] = (Object.keys(DRIVER_SENSITIVITY) as DriverKey[]).map(key => {
    const spec = DRIVER_SENSITIVITY[key];
    const value = Number(drivers[key]);
    const base = baseline[key];
    // Movement away from the reference is what changes the number, so an untouched
    // slider contributes nothing and the baseline probability is never double-counted.
    // Drivers with no measured baseline count from their healthy end instead.
    const reference = typeof base === 'number' ? base : NEUTRAL_DRIVER[key];
    const delta = adverseFraction(key, value) - adverseFraction(key, reference);
    const points = round(delta * spec.max_points);
    return {
      key,
      label: spec.label,
      value,
      baseline: typeof base === 'number' ? base : null,
      points,
      direction: points > 0 ? 'increases' : points < 0 ? 'decreases' : 'neutral',
      basis: `${spec.max_points} pts at ${spec.reference} ${spec.unit}`,
    };
  });
  const applied = contributions.reduce((sum, row) => sum + row.points, 0);
  const probability = round(clamp(basePercent + applied, 0, 98));
  return { probability, base_percent: round(basePercent), applied_points: round(applied), contributions };
}

/**
 * Working days the schedule slips at a given probability, relative to the baseline.
 * Uses the forecast's own remaining duration so the shift stays in the project's units.
 */
export function shiftFinishDate(finishDate: Date | null, remainingWorkingDays: number | null, basePercent: number, probability: number): { date: string | null; shifted_working_days: number | null } {
  if (!finishDate || remainingWorkingDays === null || remainingWorkingDays <= 0) {
    return { date: finishDate ? finishDate.toISOString().slice(0, 10) : null, shifted_working_days: null };
  }
  // Each point of extra delay risk stretches the remaining run by 1% of itself.
  const extra = Math.round(remainingWorkingDays * ((probability - basePercent) / 100));
  if (!Number.isFinite(extra) || extra === 0) {
    return { date: finishDate.toISOString().slice(0, 10), shifted_working_days: 0 };
  }
  const day = new Date(finishDate.getTime());
  const step = extra > 0 ? 1 : -1;
  let moved = 0;
  while (moved < Math.abs(extra)) {
    day.setUTCDate(day.getUTCDate() + step);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) moved++;
  }
  return { date: day.toISOString().slice(0, 10), shifted_working_days: extra };
}
