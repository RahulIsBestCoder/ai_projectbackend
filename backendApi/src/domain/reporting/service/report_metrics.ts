const DAY = 86400000;

/** UTC half-open windows include the final calendar day and exclude future activity. */
export function reportWindow(now: Date, start?: unknown, end?: unknown) {
  const parse = (value: unknown) => value ? new Date(String(value)) : null;
  const from = parse(start), to = parse(end);
  if (from && !Number.isFinite(from.getTime()) || to && !Number.isFinite(to.getTime())) throw new Error('Invalid sprint dates.');
  if (from && to && to < from) throw new Error('Sprint end date is before its start date.');
  const since = from || new Date(now.getTime() - 84 * DAY);
  const endExclusive = to ? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) + DAY) : now;
  const until = new Date(Math.min(endExclusive.getTime(), now.getTime()));
  const days = Math.max(0, (until.getTime() - since.getTime()) / DAY);
  return { since, until, days, weeks: days / 7 };
}

export function ratePerWeek(count: number, days: number): number | null {
  return days > 0 ? Math.round(count / days * 7 * 100) / 100 : null;
}

// Stemmed words that describe the kind of work rather than what is being built.
const GENERIC_WORDS = new Set(['and', 'the', 'for', 'with', 'of', 'to', 'in', 'on', 'by', 'new', 'user', 'page', 'sprint', 'task',
  'additional', 'service', 'module', 'feature', 'support', 'management', 'implement', 'implementation', 'crud', 'endpoint',
  'api', 'list', 'detail', 'update', 'create', 'delete', 'workflow', 'ui', 'test', 'case', 'suite']);
const stem = (w: string) => w.length > 5 && w.endsWith('ing') ? w.slice(0, -3) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
const words = (value: unknown) => String(value ?? '').toLowerCase().replace(/\.\.\.$/, '').split(/[^a-z0-9]+/)
  .map(stem).filter(w => w.length > 1 && !GENERIC_WORDS.has(w));
/** Module name before the first ":" ("Orders: Place, List" -> ["order"]). */
const headline = (value: unknown) => String(value ?? '').includes(':') ? words(String(value).split(':')[0]) : [];

/**
 * Titles match when one contains the other (titles may be truncated), when one title's module name
 * ("Orders: ...") is fully named in the other, or when at least two words, and at least half of the
 * shorter title's meaningful words, appear in the other. Generic words ("crud", "api", "service", ...) are ignored.
 */
export function titlesMatch(a: unknown, b: unknown): boolean {
  const first = words(a), second = words(b);
  if (!first.length || !second.length) return false;
  const joinedA = ` ${first.join(' ')} `, joinedB = ` ${second.join(' ')} `;
  if (joinedA.includes(joinedB) || joinedB.includes(joinedA)) return true;
  const headA = headline(a), headB = headline(b);
  if (headA.length && headA.every(w => second.includes(w))) return true;
  if (headB.length && headB.every(w => first.includes(w))) return true;
  const shared = new Set(first.filter(w => second.includes(w))).size;
  return shared >= 2 && shared / Math.min(new Set(first).size, new Set(second).size) >= 0.5;
}

export interface FeatureSignals { plan: number | null; taiga: number | null; repository: number | null }

export const FEATURE_WEIGHTS = { plan: 35, taiga: 35, repository: 30 } as const;

/**
 * Task progress = plan checklist 35% + Taiga tasks 35% + repository code evidence 30%.
 * Each signal is 0-100; a signal with no data counts as 0, so 100 needs all three.
 */
export function featureProgress(signals: FeatureSignals) {
  const names = ['plan', 'taiga', 'repository'] as const;
  const value = (n: typeof names[number]) => Number.isFinite(signals[n] as number) ? Math.max(0, Math.min(100, signals[n] as number)) : 0;
  const progress = Math.round(names.reduce((sum, n) => sum + value(n) * FEATURE_WEIGHTS[n] / 100, 0) * 10) / 10;
  return { progress, status: (progress >= 100 ? 'implemented' : progress > 0 ? 'partial' : 'not_implemented') as 'implemented' | 'partial' | 'not_implemented' };
}

const sprintName = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** A plan sprint matches a Taiga sprint by exact normalized name, otherwise by overlapping dates. */
export function sprintsMatch(planSprint: { title?: unknown; meta?: any }, taigaSprint: { name?: unknown; start_date?: unknown; end_date?: unknown }): boolean {
  if (sprintName(planSprint.title) && sprintName(planSprint.title) === sprintName(taigaSprint.name)) return true;
  const time = (v: unknown) => v ? new Date(String(v)).getTime() : NaN;
  const [ps, pe, ts, te] = [time(planSprint.meta?.start_date), time(planSprint.meta?.end_date), time(taigaSprint.start_date), time(taigaSprint.end_date)];
  if (![ps, pe, ts, te].every(Number.isFinite)) return false;
  const overlap = Math.min(pe, te) - Math.max(ps, ts);
  return overlap > 0 && overlap >= 0.5 * Math.min(pe - ps, te - ts);
}
