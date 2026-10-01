/**
 * Shared completion truth for the whole project.
 *
 * Precedence (product rule):
 *   1. A plan execution item ticked by a user IS completed. Highest authority;
 *      nothing overrides it.
 *   2. An unticked plan item falls back to source evidence — the matching Taiga
 *      task or work item — exactly as before.
 *   3. Source items are tracked on their own delivery track. Plan items and source
 *      items are different granularities (features vs. tickets), so they are NOT
 *      pooled into one percentage; the plan checklist is the headline and source
 *      closure is reported alongside it.
 *
 * ACCEPTANCE_CONFLICT (rule book §16) means a real disagreement: an item ticked by
 * a user whose matched source item is still open. Having no counterpart at all is
 * not a conflict — the two tracks simply describe different things.
 */

export const COMPLETION_RESOLVER_VERSION = 'completion-truth-v2';

export type CompletionSource = 'user_checklist' | 'taiga' | 'work_item' | 'none';

export interface PlanItemInput {
  id: string;
  kind: string;
  ref_key: string;
  parent_key?: string | null;
  title: string;
  is_completed: boolean;
  completed_at: Date | null;
  meta?: Record<string, any> | null;
}

export interface SourceItemInput {
  id: string;
  title: string;
  closed: boolean;
  acceptedAt: Date | null;
  createdAt: Date | null;
  dueAt: Date | null;
  sprintKey: string | null;
  origin: 'taiga' | 'work_item';
}

export interface ResolvedPlanItem {
  key: string;
  title: string;
  kind: string;
  completed: boolean;
  source: CompletionSource;
  acceptedAt: Date | null;
  ticked: boolean;
  matched_source_id: string | null;
  match: 'normalised' | 'none';
  conflict: null | 'TICKED_BUT_SOURCE_OPEN';
}

export interface CompletionTruth {
  version: string;
  /** `user_checklist` when an accepted plan checklist exists, else `source_only`. */
  basis: 'user_checklist' | 'source_only';
  /** Headline completion: the plan checklist when present, otherwise source closure. */
  percent: number | null;
  completed: number;
  total: number;
  plan_track: {
    available: boolean;
    total: number;
    completed: number;
    ticked: number;
    completed_by_source: number;
    percent: number | null;
    items: ResolvedPlanItem[];
  };
  source_track: {
    available: boolean;
    origin: 'taiga' | 'work_item' | null;
    total: number;
    closed: number;
    percent: number | null;
    linked_to_plan: number;
  };
  conflicts: Array<{ title: string; kind: string; conflict: string; source_state: string }>;
  flags: string[];
  notes: string[];
}

/** Title key for matching: lowercase, alphanumerics only, common noise words dropped. */
export function titleKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|of|for|to|and|or|in|on|at|is|be|should|check|description)\b/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Resolve one project's completion state as two independent tracks.
 * Only 'task' and 'milestone' plan kinds are deliverable work; sprints, deadlines
 * and dependencies are schedule scaffolding and are excluded.
 */
export function resolveCompletion(planItems: PlanItemInput[], sourceItems: SourceItemInput[]): CompletionTruth {
  const deliverableKinds = new Set(['task', 'milestone']);
  const plan = planItems.filter(item => deliverableKinds.has(String(item.kind)));

  // Index source items by title key. A key claimed once is not reused, so a second
  // plan item with the same title reports no match rather than double-counting.
  const byKey = new Map<string, SourceItemInput[]>();
  for (const source of sourceItems) {
    const key = titleKey(source.title);
    if (!key) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(source); else byKey.set(key, [source]);
  }

  const consumed = new Set<string>();
  const items: ResolvedPlanItem[] = [];
  const conflicts: CompletionTruth['conflicts'] = [];

  for (const item of plan) {
    const key = titleKey(item.title);
    const candidates = key ? byKey.get(key) || [] : [];
    const match = candidates.find(candidate => !consumed.has(candidate.id)) || null;
    if (match) consumed.add(match.id);

    if (item.is_completed) {
      // Rule 1: the tick is the truth. Only a matched-but-open source is a conflict.
      const conflict = match && !match.closed ? 'TICKED_BUT_SOURCE_OPEN' as const : null;
      if (conflict) {
        conflicts.push({ title: item.title, kind: item.kind, conflict, source_state: `${match!.origin}:open` });
      }
      items.push({
        key: item.ref_key, title: item.title, kind: item.kind,
        completed: true, source: 'user_checklist',
        acceptedAt: item.completed_at || match?.acceptedAt || null,
        ticked: true, matched_source_id: match?.id || null,
        match: match ? 'normalised' : 'none', conflict,
      });
      continue;
    }

    // Rule 2: unticked falls back to source evidence.
    items.push({
      key: item.ref_key, title: item.title, kind: item.kind,
      completed: !!match?.closed,
      source: match ? (match.origin === 'taiga' ? 'taiga' : 'work_item') : 'none',
      acceptedAt: match?.closed ? match.acceptedAt : null,
      ticked: false, matched_source_id: match?.id || null,
      match: match ? 'normalised' : 'none', conflict: null,
    });
  }

  const planCompleted = items.filter(row => row.completed).length;
  const planTicked = items.filter(row => row.ticked).length;
  const planPercent = items.length ? Math.round((planCompleted / items.length) * 1000) / 10 : null;

  // Rule 3: the source track is reported whole, on its own terms.
  const sourceClosed = sourceItems.filter(row => row.closed).length;
  const sourcePercent = sourceItems.length ? Math.round((sourceClosed / sourceItems.length) * 1000) / 10 : null;

  const flags: string[] = [];
  if (conflicts.length) flags.push('ACCEPTANCE_CONFLICT');

  const notes: string[] = [];
  if (items.length && sourceItems.length && consumed.size === 0) {
    notes.push('PLAN_AND_SOURCE_TRACKS_INDEPENDENT');
  }
  if (items.length && !sourceItems.length) notes.push('NO_SOURCE_ITEMS');
  if (!items.length && sourceItems.length) notes.push('NO_ACCEPTED_PLAN_CHECKLIST');

  const basis: CompletionTruth['basis'] = items.length ? 'user_checklist' : 'source_only';
  return {
    version: COMPLETION_RESOLVER_VERSION,
    basis,
    percent: basis === 'user_checklist' ? planPercent : sourcePercent,
    completed: basis === 'user_checklist' ? planCompleted : sourceClosed,
    total: basis === 'user_checklist' ? items.length : sourceItems.length,
    plan_track: {
      available: items.length > 0,
      total: items.length,
      completed: planCompleted,
      ticked: planTicked,
      completed_by_source: planCompleted - planTicked,
      percent: planPercent,
      items,
    },
    source_track: {
      available: sourceItems.length > 0,
      origin: sourceItems.length ? sourceItems[0].origin : null,
      total: sourceItems.length,
      closed: sourceClosed,
      percent: sourcePercent,
      linked_to_plan: consumed.size,
    },
    conflicts,
    flags,
    notes,
  };
}

/** Load the rows the resolver needs: accepted plan checklist + Taiga tasks or work items. */
export async function loadCompletionInputs(db: any, projectId: string): Promise<{ planItems: PlanItemInput[]; sourceItems: SourceItemInput[] }> {
  const toDate = (value: any): Date | null => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const plans = await db.collection('ai_plans')
    .find({ project_id: projectId, status: 'accepted', is_deleted: false })
    .sort({ accepted_at: -1 }).limit(1).toArray();

  let planItems: PlanItemInput[] = [];
  if (plans.length) {
    const rows = await db.collection('plan_execution_items')
      .find({ plan_id: String(plans[0]._id), is_deleted: false }).toArray();
    planItems = rows.map((row: any) => ({
      id: String(row._id), kind: String(row.kind), ref_key: row.ref_key, parent_key: row.parent_key || null,
      title: row.title || '', is_completed: !!row.is_completed, completed_at: toDate(row.completed_at), meta: row.meta || {},
    }));
  }

  const taigaRows = await db.collection('taiga_tasks')
    .find({ project_id: projectId, is_deleted: { $ne: true }, taiga_task_id: { $exists: true, $ne: null } })
    .project({ subject: 1, is_closed: 1, finished_date: 1, created_date: 1, due_date: 1, taiga_milestone_id: 1 })
    .toArray();

  let sourceItems: SourceItemInput[];
  if (taigaRows.length) {
    sourceItems = taigaRows.map((row: any) => ({
      id: String(row._id), title: row.subject || '', closed: !!row.is_closed,
      acceptedAt: toDate(row.finished_date), createdAt: toDate(row.created_date), dueAt: toDate(row.due_date),
      sprintKey: row.taiga_milestone_id != null ? String(row.taiga_milestone_id) : null, origin: 'taiga',
    }));
  } else {
    const workItems = await db.collection('work_items')
      .find({ project_id: projectId, is_deleted: { $ne: true } })
      .project({ title: 1, status: 1, completed_at: 1, updated_at: 1, created_at: 1, due_date: 1, sprint_id: 1 })
      .toArray();
    sourceItems = workItems.map((row: any) => {
      const closed = ['done', 'completed', 'closed'].includes(String(row.status || '').toLowerCase());
      return {
        id: String(row._id), title: row.title || '', closed,
        acceptedAt: closed ? toDate(row.completed_at || row.updated_at) : null,
        createdAt: toDate(row.created_at), dueAt: toDate(row.due_date),
        sprintKey: row.sprint_id ? String(row.sprint_id) : null, origin: 'work_item',
      };
    });
  }

  return { planItems, sourceItems };
}

/**
 * Deadline/forecast scope from the resolved truth: what counts as delivered and what
 * remains. Plan checklist wins when it exists; acceptance dates drive the velocity
 * window, so ticks without a date fall back to the caller's `now`.
 */
export function forecastScope(truth: CompletionTruth, now: Date): {
  workUnit: 'PLAN_CHECKLIST_ITEM' | 'TAIGA_TASK_COUNT' | 'WORK_ITEM_COUNT';
  totalItems: number;
  remainingItems: number;
  acceptedDates: Date[];
  acceptanceDateBasis: string;
} {
  if (truth.basis === 'user_checklist') {
    const accepted = truth.plan_track.items
      .filter(item => item.completed)
      .map(item => item.acceptedAt || now);
    return {
      workUnit: 'PLAN_CHECKLIST_ITEM',
      totalItems: truth.plan_track.total,
      remainingItems: truth.plan_track.total - truth.plan_track.completed,
      acceptedDates: accepted,
      acceptanceDateBasis: 'PLAN_ITEM_CHECKED_AT',
    };
  }
  return {
    workUnit: truth.source_track.origin === 'taiga' ? 'TAIGA_TASK_COUNT' : 'WORK_ITEM_COUNT',
    totalItems: truth.source_track.total,
    remainingItems: truth.source_track.total - truth.source_track.closed,
    acceptedDates: [],
    acceptanceDateBasis: truth.source_track.origin === 'taiga' ? 'TAIGA_FINISHED_DATE' : 'WORK_ITEM_COMPLETED_AT',
  };
}
