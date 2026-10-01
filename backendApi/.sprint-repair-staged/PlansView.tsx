'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  Loader2,
  Wand2,
  X,
  RefreshCw,
  AlertTriangle,
  Flag,
  CalendarClock,
  History,
  Check,
  CircleCheck,
  Pencil,
  Trash2,
  Plus,
  Save,
  Undo2,
  FilePlus2,
  Lock,
  UploadCloud,
} from 'lucide-react';
import {
  GeneratePlanInput,
  GeneratedPlan,
  SavedPlan,
  SprintPlan,
  PlanSprint,
  PlanTask,
  PlanMilestone,
  PlanDeadline,
  PlanRisk,
  AcceptedPlanRecord,
  PlanDraftRecord,
  PlanTaigaSyncStatus,
} from '@shared/models';
import {
  generatePlan,
  listPlans,
  getPlan,
  acceptPlan,
  getPlanExecution,
  toggleExecutionItem,
  createPlanInTaiga,
  getPlanTaigaSync,
  getTaigaStatus,
} from '@core/services';
import {
  getAcceptedPlan,
  saveAcceptedPlan,
  getHiddenPlanIds,
  hidePlanId,
} from '@core/services/acceptedPlan';
import {
  getPlanDraft,
  savePlanDraft,
  clearPlanDraft,
} from '@core/services/planDraft';

const TODAY = new Date().toISOString().slice(0, 10);
const LOADER_STEPS = [
  'Analyzing requirements',
  'Dividing sprints',
  'Estimating deadlines',
  'Assessing risks',
];
const ROLES = ['', 'frontend', 'backend', 'fullstack', 'qa', 'devops', 'design'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const emptyTask = (): PlanTask => ({
  title: '',
  type: 'task',
  priority: 'medium',
  assigneeRole: '',
  storyPoints: undefined,
  estimateHours: undefined,
});

const emptySprint = (index: number): PlanSprint => ({
  index,
  name: `Sprint ${index}`,
  goal: '',
  startDate: '',
  endDate: '',
  deadline: '',
  plannedPoints: undefined,
  tasks: [emptyTask()],
});

const emptyPlan = (): SprintPlan => ({
  planName: '',
  summary: '',
  sprints: [emptySprint(1)],
  milestones: [],
  deadlines: [],
  risks: [],
  assumptions: [],
});

type Mode = 'ai' | 'manual';
type DraftSource = 'ai' | 'manual';

// ---------------------------------------------------------------------------
// Re-publishing an edited accepted plan: find which sections changed so the
// matching execution-checklist items can be unchecked. Sprints/tasks/etc. are
// matched by position (edits keep positions; add/remove sets `structural`).
// ---------------------------------------------------------------------------

const SPRINT_FIELDS: (keyof PlanSprint)[] = [
  'name',
  'goal',
  'startDate',
  'endDate',
  'deadline',
  'plannedPoints',
];
const TASK_FIELDS: (keyof PlanTask)[] = [
  'title',
  'description',
  'type',
  'priority',
  'assigneeRole',
  'estimateHours',
  'storyPoints',
];

const fieldsChanged = <T,>(a: T, b: T, fields: (keyof T)[]): boolean =>
  fields.some((f) => (a?.[f] ?? '') !== (b?.[f] ?? ''));

interface PlanDiff {
  sprints: Set<number>;
  tasks: Set<string>; // `${sprintIndex}:${taskIndex}`
  milestones: Set<number>;
  deadlines: Set<number>;
  structural: boolean; // a sprint/task/milestone/deadline was added or removed
}

function diffPlan(base: SprintPlan, next: SprintPlan): PlanDiff {
  const d: PlanDiff = {
    sprints: new Set(),
    tasks: new Set(),
    milestones: new Set(),
    deadlines: new Set(),
    structural: false,
  };

  const bs = base.sprints ?? [];
  const ns = next.sprints ?? [];
  if (bs.length !== ns.length) d.structural = true;
  for (let i = 0; i < Math.min(bs.length, ns.length); i++) {
    if (fieldsChanged(bs[i], ns[i], SPRINT_FIELDS)) d.sprints.add(i);
    const bt = bs[i].tasks ?? [];
    const nt = ns[i].tasks ?? [];
    if (bt.length !== nt.length) {
      d.structural = true;
      d.sprints.add(i);
    }
    for (let j = 0; j < Math.min(bt.length, nt.length); j++) {
      if (fieldsChanged(bt[j], nt[j], TASK_FIELDS)) {
        d.tasks.add(`${i}:${j}`);
        d.sprints.add(i); // uncheck the parent sprint too
      }
    }
  }

  const bm = base.milestones ?? [];
  const nm = next.milestones ?? [];
  if (bm.length !== nm.length) d.structural = true;
  for (let k = 0; k < Math.min(bm.length, nm.length); k++) {
    if (
      (bm[k].name ?? '') !== (nm[k].name ?? '') ||
      (bm[k].date ?? '') !== (nm[k].date ?? '') ||
      (bm[k].description ?? '') !== (nm[k].description ?? '')
    )
      d.milestones.add(k);
  }

  const bd = base.deadlines ?? [];
  const nd = next.deadlines ?? [];
  if (bd.length !== nd.length) d.structural = true;
  for (let k = 0; k < Math.min(bd.length, nd.length); k++) {
    if ((bd[k].label ?? '') !== (nd[k].label ?? '') || (bd[k].date ?? '') !== (nd[k].date ?? ''))
      d.deadlines.add(k);
  }

  return d;
}

export const PlansView: React.FC<{
  projectId: string;
  projectName?: string;
  onToast: (m: string) => void;
}> = ({ projectId, projectName, onToast }) => {
  const [mode, setMode] = useState<Mode>('ai');

  // ---- AI brief form ------------------------------------------------------
  const [description, setDescription] = useState('');
  // null = leave empty -> the AI decides the optimal value.
  // Team composition per department — total = team size.
  const [deptUi, setDeptUi] = useState<number | null>(null);
  const [deptBackend, setDeptBackend] = useState<number | null>(null);
  const [deptApp, setDeptApp] = useState<number | null>(null);
  const [deptOthers, setDeptOthers] = useState<number | null>(null);
  const [durationWeeks, setDurationWeeks] = useState<number | null>(null);
  const [sprintLengthWeeks, setSprintLengthWeeks] = useState<number | null>(null);
  const [startDate, setStartDate] = useState(TODAY);
  const [projectDeadline, setProjectDeadline] = useState('');
  const [planningRules, setPlanningRules] = useState('');
  const [featuresText, setFeaturesText] = useState(''); // one feature per line
  const [constraintsText, setConstraintsText] = useState('');

  // ---- request state ---------------------------------------------------
  const [generating, setGenerating] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [lastInput, setLastInput] = useState<GeneratePlanInput | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ---- working draft (the editable plan) --------------------------------
  const [draft, setDraft] = useState<SprintPlan | null>(null);
  const [draftSource, setDraftSource] = useState<DraftSource | null>(null);
  const [draftMeta, setDraftMeta] = useState<{ planId?: string; generatedBy?: string; model?: string }>(
    {},
  );
  const [pristine, setPristine] = useState<SprintPlan | null>(null); // last generated, for "reset edits"

  // ---- accepted plan + history ----------------------------------------
  const [accepted, setAccepted] = useState<AcceptedPlanRecord | null>(null);
  const [serverAcceptedId, setServerAcceptedId] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  // Re-editing an already-accepted plan: unlock the editor, then "Publish
  // changes" re-saves it and unchecks the checklist items that were edited.
  const [editingAccepted, setEditingAccepted] = useState(false);
  const [editBaseline, setEditBaseline] = useState<SprintPlan | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [history, setHistory] = useState<SavedPlan[]>([]);
  const [hiddenPlanIds, setHiddenPlanIds] = useState<Set<string>>(new Set());
  // The user's edited plan saved via "Save draft" (survives refresh / project switch).
  const [savedDraft, setSavedDraft] = useState<PlanDraftRecord | null>(null);

  const constraints = useMemo(
    () => constraintsText.split('\n').map((s) => s.trim()).filter(Boolean),
    [constraintsText],
  );

  const features = useMemo(
    () => featuresText.split('\n').map((s) => s.trim()).filter(Boolean),
    [featuresText],
  );

  // Auto-calculated total of the department inputs (0 when all are empty).
  const deptTotal = (deptUi ?? 0) + (deptBackend ?? 0) + (deptApp ?? 0) + (deptOthers ?? 0);

  const dirty = useMemo(
    () => (draft && pristine ? JSON.stringify(draft) !== JSON.stringify(pristine) : false),
    [draft, pristine],
  );

  // The backend is authoritative for acceptance. The local AcceptedPlanRecord
  // keeps richer edit metadata, but must not be the only way the UI knows which
  // plan is active after a refresh or on another browser.
  const acceptedHistoryPlan = useMemo(
    () => history.find((row) => row.status === 'accepted') ?? null,
    [history],
  );
  const acceptedPlanName = accepted?.plan.planName
    || acceptedHistoryPlan?.title
    || acceptedHistoryPlan?.plan?.planName
    || 'Untitled plan';
  const acceptedPlanDate = accepted?.acceptedAt || acceptedHistoryPlan?.acceptedAt || acceptedHistoryPlan?.createdAt || '';

  const loadHistory = async () => {
    const rows = await listPlans(projectId);
    rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    setHistory(rows);
  };

  useEffect(() => {
    setAccepted(getAcceptedPlan(projectId));
    setHiddenPlanIds(getHiddenPlanIds(projectId));
    setSavedDraft(getPlanDraft(projectId));
    setDraft(null);
    setDraftSource(null);
    setPristine(null);
    setServerAcceptedId(null);
    setEditingAccepted(false);
    setEditBaseline(null);
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const removeFromHistory = (id: string) => {
    hidePlanId(projectId, id);
    setHiddenPlanIds(new Set(getHiddenPlanIds(projectId)));
    onToast('Plan removed from the list.');
  };

  // ---- save the edited plan as a (resumable) draft ----------------------
  const saveDraftNow = () => {
    if (!draft || !draftSource) return;
    if (!draft.planName.trim()) {
      onToast('Give the plan a name before saving the draft.');
      return;
    }
    const baseline = editingAccepted ? editBaseline : pristine;
    const record: PlanDraftRecord = {
      savedAt: new Date().toISOString(),
      source: draftSource,
      plan: clone(draft),
      baseline: baseline ? clone(baseline) : null,
      planId: draftMeta.planId,
      generatedBy: draftMeta.generatedBy,
      model: draftMeta.model,
      editingAccepted,
      input: lastInput ?? undefined,
    };
    savePlanDraft(projectId, record);
    setSavedDraft(record);
    onToast(
      editingAccepted
        ? 'Draft saved — resume these edits any time.'
        : 'Draft saved — your edited plan is kept for this project.',
    );
  };

  const resumeDraft = () => {
    if (!savedDraft) return;
    setDraft(clone(savedDraft.plan));
    setPristine(savedDraft.baseline ? clone(savedDraft.baseline) : null);
    setDraftSource(savedDraft.source);
    setDraftMeta({
      planId: savedDraft.planId,
      generatedBy: savedDraft.generatedBy,
      model: savedDraft.model,
    });
    setMode(savedDraft.source);
    setLastInput(savedDraft.input ?? null);
    if (savedDraft.editingAccepted) {
      setEditBaseline(savedDraft.baseline ? clone(savedDraft.baseline) : null);
      setEditingAccepted(true);
    } else {
      clearEditState();
    }
    onToast('Draft resumed — your saved edits are back.');
  };

  const discardDraft = () => {
    clearPlanDraft(projectId);
    setSavedDraft(null);
    onToast('Saved draft discarded.');
  };

  const visibleHistory = history.filter((r) => !hiddenPlanIds.has(r.id));

  useEffect(() => {
    if (!generating) return;
    setStepIdx(0);
    const t = setInterval(() => setStepIdx((i) => (i + 1) % LOADER_STEPS.length), 2500);
    return () => clearInterval(t);
  }, [generating]);

  // ---- AI generate -----------------------------------------------------
  const buildInput = (): GeneratePlanInput => {
    // Features are first-class in the form. We send them under `features`
    // (forward-compatible) AND merged into `constraints` so the backend's
    // constraints[] prompt builder honours them today.
    const featureList = features.length ? features : undefined;
    const mergedConstraints =
      features.length || constraints.length ? [...features, ...constraints] : undefined;
    // Department breakdown -> team_breakdown (toApi). Only non-zero departments are
    // included; when the whole breakdown is empty the key is omitted so the AI decides.
    const teamBreakdown: NonNullable<GeneratePlanInput['teamBreakdown']> = {};
    if (deptUi != null && deptUi > 0) teamBreakdown.ui = deptUi;
    if (deptBackend != null && deptBackend > 0) teamBreakdown.backend = deptBackend;
    if (deptApp != null && deptApp > 0) teamBreakdown.app = deptApp;
    if (deptOthers != null && deptOthers > 0) teamBreakdown.others = deptOthers;
    return {
      description: description.trim(),
      projectName: projectName?.trim() || undefined,
      projectId: projectId || undefined,
      teamBreakdown: Object.keys(teamBreakdown).length ? teamBreakdown : undefined,
      durationWeeks: durationWeeks ?? undefined,
      sprintLengthWeeks: sprintLengthWeeks ?? undefined,
      startDate: startDate || undefined,
      deadline: projectDeadline || undefined,
      rules: planningRules.trim() || undefined,
      features: featureList,
      constraints: mergedConstraints,
    };
  };

  const run = async (input: GeneratePlanInput) => {
    if (!input.description) {
      onToast('Describe the project to plan first.');
      return;
    }
    abortRef.current = new AbortController();
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    const effectiveStart = input.startDate || new Date().toISOString().slice(0, 10);
    if (!validDate(effectiveStart) || (input.deadline && !validDate(input.deadline))) {
      onToast('Enter valid start and deadline dates.');
      return;
    }
    if (input.deadline && input.deadline < effectiveStart) {
      onToast('Deadline cannot be before the start date.');
      return;
    }
    if (input.deadline && (Date.parse(input.deadline) - Date.parse(effectiveStart)) / 86400000 + 1 > 728) {
      onToast('Planning horizon cannot exceed 104 weeks.');
      return;
    }
    for (const [value, max, label] of [[input.durationWeeks, 104, 'Project duration'], [input.sprintLengthWeeks, 4, 'Sprint length']] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > max)) {
        onToast(`${label} must be an integer from 1 to ${max} weeks.`);
        return;
      }
    }
    const teamCounts = Object.values(input.teamBreakdown || {});
    if (teamCounts.some(n => !Number.isInteger(n) || n < 0) || teamCounts.reduce((sum, n) => sum + n, 0) > 1000) {
      onToast('Team counts must be whole numbers, with at most 1000 people total.');
      return;
    }
    setGenerating(true);
    try {
      const gen: GeneratedPlan = await generatePlan(input, abortRef.current.signal);
      const p = clone(gen.plan);
      setDraft(p);
      setPristine(clone(p));
      setDraftSource('ai');
      setDraftMeta({ planId: gen.id, generatedBy: gen.generatedBy, model: gen.model });
      setLastInput(input);
      clearEditState();
      onToast(
        gen.generatedBy === 'google'
          ? `Plan generated — ${gen.plan.sprints?.length ?? 0} sprints. Review, edit, then accept.`
          : 'Fallback plan generated. Review, edit, then accept.',
      );
      loadHistory();
    } catch (err: any) {
      if (
        err?.name === 'CanceledError' ||
        err?.code === 'ERR_CANCELED' ||
        err?.msg === 'canceled' ||
        err?.message === 'canceled'
      ) {
        onToast('Generation cancelled.');
      } else {
        onToast(err?.msg || err?.message || 'Plan generation failed');
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  /** Leave "editing an accepted plan" mode (called whenever a new draft loads). */
  const clearEditState = () => {
    setEditingAccepted(false);
    setEditBaseline(null);
  };

  // ---- manual -------------------------------------------------------
  const startBlank = () => {
    const p = emptyPlan();
    setDraft(p);
    setPristine(null);
    setDraftSource('manual');
    setDraftMeta({});
    clearEditState();
  };

  const startFromLastAi = () => {
    if (!visibleHistory.length) return;
    const p = clone(visibleHistory[0].plan);
    setDraft(p);
    setPristine(null);
    setDraftSource('manual');
    setDraftMeta({});
    clearEditState();
    onToast('Loaded the latest AI plan for manual editing.');
  };

  // ---- accept / discard -------------------------------------------------
  const acceptDraft = async () => {
    if (!draft || !draftSource) return;
    if (!draft.planName.trim()) {
      onToast('Give the plan a name before accepting.');
      return;
    }
    const record: AcceptedPlanRecord = {
      source: draftSource,
      acceptedAt: new Date().toISOString(),
      planId: draftMeta.planId,
      generatedBy: draftMeta.generatedBy,
      model: draftMeta.model,
      plan: clone(draft),
    };
    saveAcceptedPlan(projectId, record);
    setAccepted(record);
    // The plan is committed now — a stored work-in-progress draft is obsolete.
    clearPlanDraft(projectId);
    setSavedDraft(null);

    // A server-saved plan (has a backend id) also gets a real execution checklist,
    // which is tracked in the Execution tab.
    if (draftMeta.planId) {
      setAccepting(true);
      try {
        const r = await acceptPlan(draftMeta.planId);
        onToast(`Plan accepted — ${r.itemsCreated} checklist items. Track it in the Execution tab.`);
        setServerAcceptedId(draftMeta.planId);
      } catch (err: any) {
        if (/already accepted/i.test(err?.msg || err?.message || '')) {
          setServerAcceptedId(draftMeta.planId);
          onToast('Plan already accepted — track it in the Execution tab.');
        } else {
          onToast(err?.msg || err?.message || 'Accepted locally, but the execution checklist failed.');
        }
      } finally {
        setAccepting(false);
      }
    } else {
      onToast('Plan accepted for this project.');
    }
  };

  const viewAccepted = () => {
    if (!accepted) return;
    setDraft(clone(accepted.plan));
    setPristine(null);
    setDraftSource(accepted.source);
    setDraftMeta({
      planId: accepted.planId,
      generatedBy: accepted.generatedBy,
      model: accepted.model,
    });
    setMode(accepted.source);
    clearEditState();
  };

  const resetEdits = () => {
    if (pristine) {
      setDraft(clone(pristine));
      onToast('Reverted to the generated plan.');
    }
  };

  const openSaved = async (row: SavedPlan) => {
    const doc = (await getPlan(row.id)) || (row.plan ? row : null);
    if (!doc) {
      onToast('Could not load that plan.');
      return;
    }
    const p = clone(doc.plan);
    setDraft(p);
    setPristine(clone(p));
    setDraftSource('ai');
    setDraftMeta({ planId: doc.id, generatedBy: doc.provider, model: doc.model });
    setMode('ai');
    setServerAcceptedId(doc.status === 'accepted' ? doc.id : null);
    clearEditState();
  };

  const acceptedIsCurrent =
    accepted && draft ? JSON.stringify(accepted.plan) === JSON.stringify(draft) : false;
  // The open draft belongs to an accepted plan (backend-accepted, or it still
  // matches the saved record). Such a plan is read-only until "Edit plan".
  const isAcceptedPlan = !!serverAcceptedId || acceptedIsCurrent;
  const locked = isAcceptedPlan && !editingAccepted;

  // ---- edit an accepted plan -> draft -> re-publish -------------------
  const beginEdit = () => {
    if (!draft) return;
    setEditBaseline(clone(draft));
    setEditingAccepted(true);
    onToast('Editing the accepted plan — publish to apply your changes.');
  };

  const cancelEdit = () => {
    if (editBaseline) setDraft(clone(editBaseline));
    clearEditState();
    onToast('Edit cancelled — the accepted plan is unchanged.');
  };

  const publishEdits = async () => {
    if (!draft || !draftSource) return;
    if (!draft.planName.trim()) {
      onToast('Give the plan a name before publishing.');
      return;
    }
    if (editBaseline && JSON.stringify(editBaseline) === JSON.stringify(draft)) {
      clearEditState();
      onToast('No changes to publish.');
      return;
    }

    const record: AcceptedPlanRecord = {
      source: draftSource,
      acceptedAt: new Date().toISOString(),
      planId: draftMeta.planId,
      generatedBy: draftMeta.generatedBy,
      model: draftMeta.model,
      plan: clone(draft),
    };
    saveAcceptedPlan(projectId, record);
    setAccepted(record);
    // The plan is committed now — the stored draft is obsolete.
    clearPlanDraft(projectId);
    setSavedDraft(null);

    let resetCount = 0;
    let structural = false;

    if (draftMeta.planId && editBaseline) {
      setPublishing(true);
      try {
        const diff = diffPlan(editBaseline, draft);
        structural = diff.structural;
        const exec = await getPlanExecution(draftMeta.planId);
        if (exec) {
          const patches: Promise<unknown>[] = [];
          const reset = (kind: 'sprint' | 'task' | 'milestone' | 'deadline', id?: string, done?: boolean) => {
            if (!id || !done) return;
            patches.push(toggleExecutionItem(draftMeta.planId!, kind, id, false));
            resetCount += 1;
          };
          diff.sprints.forEach((i) => reset('sprint', exec.sprints[i]?.id, exec.sprints[i]?.isCompleted));
          diff.tasks.forEach((key) => {
            const [i, j] = key.split(':').map(Number);
            const t = exec.sprints[i]?.tasks[j];
            reset('task', t?.id, t?.isCompleted);
          });
          diff.milestones.forEach((k) => reset('milestone', exec.milestones[k]?.id, exec.milestones[k]?.isCompleted));
          diff.deadlines.forEach((k) => reset('deadline', exec.deadlines[k]?.id, exec.deadlines[k]?.isCompleted));
          await Promise.allSettled(patches);
        }
      } catch (err: any) {
        onToast(err?.msg || err?.message || 'Published locally, but the checklist could not be updated.');
        setPublishing(false);
        clearEditState();
        return;
      }
      setPublishing(false);
    }

    clearEditState();
    const tail = resetCount
      ? `${resetCount} checklist item${resetCount === 1 ? '' : 's'} unchecked`
      : 'checklist progress kept';
    onToast(
      `Changes published — ${tail}.` +
        (structural ? ' Added/removed sections need a Rebuild in the Execution tab.' : ''),
    );
  };

  // ---- Taiga publish pipeline -------------------------------------------
  const [taigaStatus, setTaigaStatus] = useState<{ connected: boolean; planPublished?: boolean; hasSprints?: boolean; canCreateSprints?: boolean; creationBlockedReason?: string } | null>(null);
  const [taigaPublishing, setTaigaPublishing] = useState(false);
  const [taigaPreview, setTaigaPreview] = useState<any>(null);
  const taigaInFlight = useRef(false);
  const [taigaError, setTaigaError] = useState<string | null>(null);
  /** Plan-scoped publish state (GET /v1/plans/:planId/taiga-sync). */
  const [taigaSyncRaw, setTaigaSyncRaw] = useState<PlanTaigaSyncStatus | null>(null);

  // Look up the Taiga connection status whenever the project changes.
  useEffect(() => {
    let alive = true;
    setTaigaStatus(null);
    (async () => {
      try {
        const st = await getTaigaStatus(projectId);
        if (alive) setTaigaStatus(st);
      } catch {
        if (alive) setTaigaStatus(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  const acceptedPlanId = accepted?.planId ?? serverAcceptedId ?? null;

  // Publish state of the accepted plan — drives Create vs Sync vs Retry.
  useEffect(() => {
    if (!acceptedPlanId) return; // nothing selected — the derived value below masks stale state
    let alive = true;
    (async () => {
      const st = await getPlanTaigaSync(acceptedPlanId);
      if (alive) setTaigaSyncRaw(st);
    })();
    return () => {
      alive = false;
    };
  }, [acceptedPlanId]);

  /** Only trust the status that belongs to the currently selected plan. */
  const taigaSync =
    acceptedPlanId && taigaSyncRaw?.planId === acceptedPlanId ? taigaSyncRaw : null;

  /** `sync` once the plan already exists in Taiga: creates missing, updates mapped. */
  const taigaMode: 'create' | 'sync' = taigaSync?.planPublished ? 'sync' : 'create';

  // Publish every sprint and task directly; sync also resumes an earlier attempt.
  const handleTaigaCreate = async () => {
    if (!acceptedPlanId || taigaInFlight.current) return;
    taigaInFlight.current = true;
    setTaigaPublishing(true);
    setTaigaError(null);
    setTaigaPreview(null);
    try {
      const current = await getTaigaStatus(projectId);
      setTaigaStatus(current);
      if (current.canCreateSprints !== true) {
        const reason = current.hasSprints ? 'This Taiga project already has sprints. Sprint creation is disabled.' : 'Unable to confirm this Taiga project is empty. Refresh and try again.';
        setTaigaError(reason);
        onToast(reason);
        return;
      }
      const result = await createPlanInTaiga(acceptedPlanId, 'sync', { allowUnassigned: true });
      setTaigaPreview(result);
      const s = result.summary;
      const total = (stage: any) => (stage?.created ?? 0) + (stage?.updated ?? 0);
      const counts = total(s?.milestones) + ' sprints, ' + total(s?.userStories) + ' stories, ' + total(s?.tasks) + ' tasks';
      if (result.status !== 'completed') {
        setTaigaError('Some items could not be published. Click Retry Taiga sync to finish.');
        onToast('Taiga publish incomplete — see the details.');
      } else {
        const unassigned = result.warnings?.filter(w => w.type === 'USER_ROLE_UNMAPPED').length ?? 0;
        onToast('Published to Taiga — ' + counts + (unassigned ? '. ' + unassigned + ' tasks have no mapped assignee.' : '.'));
      }
      const [connection, sync] = await Promise.allSettled([
        getTaigaStatus(projectId), getPlanTaigaSync(acceptedPlanId),
      ]);
      if (connection.status === 'fulfilled') setTaigaStatus(connection.value);
      if (sync.status === 'fulfilled') setTaigaSyncRaw(sync.value);
    } catch (err: any) {
      const msg = err?.msg || err?.message || 'Create in Taiga failed';
      if (String(msg).includes('TAIGA_SPRINTS_EXIST')) setTaigaStatus(previous => previous ? { ...previous, hasSprints: true, canCreateSprints: false } : previous);
      setTaigaError(msg);
      onToast(msg);
    } finally {
      taigaInFlight.current = false;
      setTaigaPublishing(false);
    }
  };

  const taigaAction = () => { void handleTaigaCreate(); };
  const taigaPublishDisabled = !accepted?.planId || !taigaStatus?.connected || taigaStatus?.canCreateSprints !== true;
  const taigaPublishTooltip = taigaStatus?.hasSprints ? 'This Taiga project already has sprints. Sprint creation is disabled.' : !accepted?.planId
    ? 'Accept the plan first'
    : !taigaStatus?.connected
      ? 'Connect Taiga first'
      : taigaSync?.publishStatus === 'partial'
        ? 'Some items failed — retry the Taiga sync'
        : taigaMode === 'sync'
          ? 'Sync this plan to Taiga (creates missing, updates mapped)'
          : 'Create this plan in Taiga';
  const taigaButtonLabel = taigaStatus?.hasSprints ? 'Sprints already exist' :
    taigaSync?.publishStatus === 'partial'
      ? 'Retry Taiga sync'
      : taigaMode === 'sync'
        ? 'Sync to Taiga'
        : 'Create in Taiga';
  const taigaLastSynced = taigaSync?.lastSyncAt
    ? new Date(taigaSync.lastSyncAt).toLocaleString()
    : null;

  return (
    <div className="space-y-5">
      <div className="p-5 bg-white border-2 border-slate-900 shadow-sm flex items-center justify-between text-indigo-700 text-xs font-black uppercase tracking-widest">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-4 h-4" />
          <span>AI Sprint Planner</span>
        </div>
        <div className="flex border border-slate-300">
          {(['ai', 'manual'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${
                mode === m ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {m === 'ai' ? 'AI generate' : 'Manual entry'}
            </button>
          ))}
        </div>
      </div>

      {/* -------------------------------------------------- accepted banner */}
      {(accepted || acceptedHistoryPlan) && (
        <div className="p-4 bg-emerald-50 border-2 border-emerald-600 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2 text-emerald-800">
            <CircleCheck className="w-4 h-4" />
            <span className="text-xs font-black uppercase tracking-widest">
              Accepted plan
            </span>
            <span className="text-[11px] font-mono text-emerald-700">
              {acceptedPlanName}
              {accepted && <> · {accepted.source === 'ai' ? 'AI + edits' : 'manual'}</>}
              {acceptedPlanDate && <> · {acceptedPlanDate.slice(0, 10)}</>}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => accepted ? viewAccepted() : acceptedHistoryPlan && void openSaved(acceptedHistoryPlan)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-emerald-100 text-emerald-800 text-[11px] font-bold uppercase tracking-wider border border-emerald-600"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>View plan</span>
            </button>
            <button
              onClick={taigaAction}
              disabled={taigaPublishDisabled || taigaPublishing}
              title={taigaPublishTooltip}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-indigo-100 text-indigo-800 text-[11px] font-bold uppercase tracking-wider border border-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {taigaPublishing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <UploadCloud className="w-3.5 h-3.5" />
              )}
              <span>{taigaPublishing ? 'Publishing all sprints...' : taigaButtonLabel}</span>
            </button>
          </div>
          {taigaStatus?.hasSprints && (
            <p role="status" className="text-xs text-amber-800">This Taiga project already has sprints. Sprint creation is disabled.</p>
          )}
          {taigaLastSynced && (
            <span className="text-[10px] font-mono text-slate-500 self-center">
              Taiga synced {taigaLastSynced}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ================================================= LEFT column === */}
        <div className="p-5 bg-white border border-slate-300 space-y-3">
          {mode === 'ai' ? (
            <>
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-900 border-b-2 border-indigo-600 pb-1 w-fit">
                Plan brief
              </h3>

              <div className="p-2.5 bg-indigo-50 border border-indigo-200 text-[10px] font-mono text-indigo-800 leading-relaxed">
                <span className="font-bold uppercase tracking-wider text-[9px] text-indigo-500 block">
                  Tip
                </span>
                Leave the <strong>team breakdown</strong>, <strong>Project Duration</strong>, and <strong>Sprint
                Duration</strong> empty for the AI to decide optimal values based on your project scope.
              </div>

              <L label="Project description *">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  placeholder="What must this project deliver? The more detail, the better the plan."
                  className="w-full bg-slate-50 border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-slate-800 focus:outline-none resize-y min-h-[60px]"
                />
              </L>

              <L
                label="Planning rules / scope"
                optional
                hint="The AI will follow these rules strictly when generating your plan"
              >
                <textarea
                  value={planningRules}
                  onChange={(e) => setPlanningRules(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="Define rules for AI to follow when generating the plan (e.g., Use React Native, prioritize iOS, must include payment integration)"
                  className="w-full bg-slate-50 border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-slate-800 focus:outline-none resize-y min-h-[60px]"
                />
              </L>

              <L
                label="Features (one per line)"
                hint="The AI will include each feature in the plan"
              >
                <textarea
                  value={featuresText}
                  onChange={(e) => setFeaturesText(e.target.value)}
                  rows={3}
                  placeholder={'cart system\nmultilingual / i18n\ndraft system'}
                  className="w-full bg-slate-50 border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-slate-800 focus:outline-none resize-y min-h-[60px]"
                />
              </L>

              <div>
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                  Team breakdown by department
                  <span className="font-normal text-slate-400"> (optional)</span>
                </span>
                <div className="p-3 bg-slate-50 border border-slate-200">
                  <div className="grid grid-cols-2 gap-2">
                    <DeptField label="UI" value={deptUi} onChange={setDeptUi} />
                    <DeptField label="Backend" value={deptBackend} onChange={setDeptBackend} />
                    <DeptField label="App" value={deptApp} onChange={setDeptApp} />
                    <DeptField label="Others" value={deptOthers} onChange={setDeptOthers} />
                  </div>
                  <div className="mt-2 px-2 py-1.5 bg-indigo-50 border border-indigo-200 text-center">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-indigo-700">
                      Total team size: <span className="font-black">{deptTotal}</span>
                    </span>
                    <span className="block text-[9px] font-mono text-slate-400">
                      (auto-calculated)
                    </span>
                  </div>
                </div>
                <span className="text-[9px] font-mono text-slate-400 block mt-1">
                  Leave empty for the AI to decide based on your project
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <L label="Project Duration (wk)" hint="AI decides if empty">
                  <NumberInput value={durationWeeks} min={1} onChange={setDurationWeeks} />
                </L>
                <L label="Sprint (wk)" hint="AI decides if empty">
                  <NumberInput value={sprintLengthWeeks} min={1} onChange={setSprintLengthWeeks} />
                </L>
                <L label="Start date">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-slate-800 focus: outline-none"
                  />
                </L>
                <L label="Project deadline" hint="Optional; final delivery target">
                  <input
                    type="date"
                    value={projectDeadline}
                    min={startDate || TODAY}
                    onChange={(e) => setProjectDeadline(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-slate-800 focus:outline-none"
                  />
                </L>
              </div>
              <p className="text-xs text-slate-500">
                If both duration and deadline are set, the earlier limit applies. The final sprint may be shorter.
                Capacity assumes 6 productive hours per weekday; review holidays, leave, estimates, and plan risks before committing.
              </p>

              <L
                label="Constraints (one per line) * strict requirements"
                hint="Hard rules the plan must respect — stack, fixed dates, staffing"
              >
                <textarea
                  value={constraintsText}
                  onChange={(e) => setConstraintsText(e.target.value)}
                  rows={3}
                  placeholder={'must use React\nfixed go-live 20 Dec\nno new hires'}
                  className="w-full bg-slate-50 border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-slate-800 focus:outline-none resize-y min-h-[60px]"
                />
              </L>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => run(buildInput())}
                  disabled={generating || !description.trim()}
                  className="flex items-center space-x-2 px-4 py-2 bg-slate-900 hover:bg-black text-white text-xs font-bold uppercase tracking-widest border border-black disabled:opacity-50"
                >
                  {generating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Wand2 className="w-4 h-4" />
                  )}
                  <span>{generating ? 'Generating…' : 'Generate plan'}</span>
                </button>
                {generating && (
                  <button
                    onClick={cancel}
                    className="flex items-center space-x-1.5 px-3 py-2 bg-white hover:bg-rose-50 text-rose-600 text-[11px] font-bold uppercase tracking-wider border border-slate-300"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Cancel</span>
                  </button>
                )}
              </div>

              {generating && (
                <div className="mt-2 border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center space-x-2 text-[11px] font-mono uppercase tracking-widest text-slate-600">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                    <span>{LOADER_STEPS[stepIdx]}…</span>
                  </div>
                  <div className="mt-2 h-1 w-full bg-slate-200 overflow-hidden">
                    <div className="h-full w-1/3 bg-indigo-600 animate-pulse" />
                  </div>
                  <p className="mt-2 text-[10px] font-mono text-slate-400">
                    AI generation can take up to ~90s. Safe to leave this tab open.
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-900 border-b-2 border-indigo-600 pb-1 w-fit">
                Manual entry
              </h3>
              <p className="text-[11px] font-mono text-slate-500 leading-relaxed">
                Build the sprint plan by hand, or start from the latest AI draft and edit
                it. Nothing is sent to the AI. Accepted plans are stored for this project.
              </p>
              {draftSource === 'manual' && draft ? (
                <p className="text-[11px] font-mono text-indigo-700 uppercase tracking-wider">
                  Editing a manual plan — see the right panel.
                </p>
              ) : (
                <div className="flex flex-col gap-2 pt-1">
                  <button
                    onClick={startBlank}
                    className="flex items-center space-x-2 px-4 py-2 bg-slate-900 hover:bg-black text-white text-xs font-bold uppercase tracking-widest border border-black"
                  >
                    <FilePlus2 className="w-4 h-4" />
                    <span>Start blank plan</span>
                  </button>
                  <button
                    onClick={startFromLastAi}
                    disabled={!visibleHistory.length}
                    className="flex items-center space-x-2 px-4 py-2 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold uppercase tracking-widest border border-slate-300 disabled:opacity-40"
                  >
                    <RefreshCw className="w-4 h-4 text-indigo-600" />
                    <span>Start from last AI plan</span>
                  </button>
                </div>
              )}
            </>
          )}

          {/* ----------------------------------------- prior plans -------- */}
          {visibleHistory.length > 0 && (
            <div className="pt-3 border-t border-slate-200">
              <div className="flex items-center space-x-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                <History className="w-3 h-3" />
                <span>Previous plans</span>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {visibleHistory.map((row) => (
                  <div
                    key={row.id}
                    className={`w-full flex items-center gap-1 px-2 py-1.5 border ${row.status === 'accepted' ? 'bg-emerald-50 hover:bg-emerald-100 border-emerald-400' : 'bg-white hover:bg-slate-100 border-slate-200'}`}
                  >
                    <button
                      onClick={() => openSaved(row)}
                      className="flex-1 min-w-0 flex items-center justify-between text-left"
                    >
                      <span className="truncate text-[11px] font-mono text-slate-700 flex items-center gap-1.5">
                        {row.title || row.plan?.planName || 'Untitled plan'}
                        {row.status === 'accepted' && <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-600 text-white text-[8px] font-black uppercase tracking-wider"><CircleCheck className="w-2.5 h-2.5" /> Accepted</span>}
                      </span>
                      <span className="shrink-0 ml-2 flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-slate-400">
                          {(row.createdAt || '').slice(0, 10)}
                        </span>
                        <ProviderBadge provider={row.provider} compact />
                      </span>
                    </button>
                    <button
                      onClick={() => removeFromHistory(row.id)}
                      title="Remove from list (local only — the backend has no plan delete)"
                      className="shrink-0 p-0.5 text-slate-300 hover:text-rose-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ================================================ RIGHT column === */}
        <div className="p-5 bg-white border border-slate-300 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-900 border-b-2 border-indigo-600 pb-1 w-fit">
                {draftSource === 'manual' ? 'Plan draft' : 'Generated plan'}
              </h3>
              {isAcceptedPlan && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-400 text-[9px] font-black uppercase tracking-wider"><CircleCheck className="w-3 h-3" /> Accepted</span>}
            </div>
            {draftMeta.generatedBy && draftSource === 'ai' && (
              <div className="flex items-center gap-1.5">
                <ProviderBadge provider={draftMeta.generatedBy} />
                {draftMeta.model && (
                  <span className="text-[9px] font-mono text-slate-400 uppercase">
                    {draftMeta.model}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ---- saved draft banner (resume / discard) ---- */}
          {savedDraft && !draft && !generating && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-amber-50 border border-amber-300">
              <span className="text-[10px] font-mono text-amber-800 leading-relaxed">
                <strong>Draft saved</strong> — {savedDraft.plan.planName || 'Untitled plan'} ·{' '}
                {savedDraft.savedAt.slice(0, 10)} {savedDraft.savedAt.slice(11, 16)}
                {savedDraft.editingAccepted ? ' (accepted-plan edits)' : ''}
              </span>
              <div className="flex gap-1.5">
                <button
                  onClick={resumeDraft}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-amber-100 text-amber-800 text-[10px] font-bold uppercase tracking-wider border border-amber-400"
                >
                  <Pencil className="w-3 h-3" />
                  <span>Resume draft</span>
                </button>
                <button
                  onClick={discardDraft}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-600 text-[10px] font-bold uppercase tracking-wider border border-slate-300"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Discard</span>
                </button>
              </div>
            </div>
          )}

          {!draft && !generating && (
            <p className="text-[11px] font-mono text-slate-400 uppercase tracking-wider py-10 text-center">
              {mode === 'ai'
                ? 'Fill the brief, then generate a plan'
                : 'Start a blank plan or load the last AI draft'}
            </p>
          )}

          {generating && (
            <div className="flex items-center justify-center py-10 text-slate-500 text-xs font-mono uppercase tracking-widest">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> {LOADER_STEPS[stepIdx]}…
            </div>
          )}

          {draft && !generating && (
            <>
              {/* ---- action bar ---- */}
              <div className="flex flex-wrap gap-2 pb-2 border-b border-slate-200">
                {editingAccepted ? (
                  <>
                    <button
                      onClick={publishEdits}
                      disabled={publishing}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold uppercase tracking-wider border border-emerald-700 disabled:opacity-40"
                    >
                      {publishing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <UploadCloud className="w-3.5 h-3.5" />
                      )}
                      <span>{publishing ? 'Publishing…' : 'Publish changes'}</span>
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={publishing}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 text-[11px] font-bold uppercase tracking-wider border border-slate-300 disabled:opacity-40"
                    >
                      <Undo2 className="w-3.5 h-3.5 text-slate-500" />
                      <span>Cancel edit</span>
                    </button>
                  </>
                ) : isAcceptedPlan ? (
                  <button
                    onClick={beginEdit}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 text-[11px] font-bold uppercase tracking-wider border border-slate-300"
                  >
                    <Pencil className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Edit plan</span>
                  </button>
                ) : (
                  <button
                    onClick={acceptDraft}
                    disabled={accepting}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold uppercase tracking-wider border border-emerald-700 disabled:opacity-40"
                  >
                    {accepting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    <span>{accepting ? 'Accepting…' : 'Accept plan'}</span>
                  </button>
                )}

                {draftSource === 'ai' && !editingAccepted && !isAcceptedPlan && (
                  <>
                    <button
                      onClick={() => lastInput && run(lastInput)}
                      disabled={generating || !lastInput}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 text-[11px] font-bold uppercase tracking-wider border border-slate-300 disabled:opacity-40"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Regenerate</span>
                    </button>
                    <button
                      onClick={resetEdits}
                      disabled={!dirty}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 text-[11px] font-bold uppercase tracking-wider border border-slate-300 disabled:opacity-40"
                    >
                      <Undo2 className="w-3.5 h-3.5 text-slate-500" />
                      <span>Reset edits</span>
                    </button>
                  </>
                )}

                {(editingAccepted || !isAcceptedPlan) && (
                  <button
                    onClick={saveDraftNow}
                    title="Save the edited plan as a draft — your edits survive a refresh or project switch"
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-indigo-50 text-indigo-700 text-[11px] font-bold uppercase tracking-wider border border-indigo-300"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save draft</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    setDraft(null);
                    setDraftSource(null);
                    setPristine(null);
                    clearEditState();
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-600 text-[11px] font-bold uppercase tracking-wider border border-slate-300"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Close</span>
                </button>

                <button
                  disabled
                  title="Pending backend: POST /v1/plans/:id/apply"
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-white text-slate-400 text-[11px] font-bold uppercase tracking-wider border border-slate-200 cursor-not-allowed"
                >
                  <span>Apply to project</span>
                </button>
              </div>

              {dirty && draftSource === 'ai' && (
                <p className="text-[10px] font-mono text-amber-700 uppercase tracking-wider">
                  Edited — differs from the generated plan.
                </p>
              )}

              {locked && (
                <p className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-700 uppercase tracking-wider">
                  <Lock className="w-3 h-3 shrink-0" />
                  <span>
                    Accepted &amp; read-only — click <strong>Edit plan</strong> to change it. Publishing
                    unchecks the Execution checklist items for the sprints/tasks you edit.
                  </span>
                </p>
              )}

              {editingAccepted && (
                <p className="flex items-center gap-1.5 text-[10px] font-mono text-amber-700 uppercase tracking-wider">
                  <Pencil className="w-3 h-3 shrink-0" />
                  <span>
                    Draft — editing the accepted plan. <strong>Publish changes</strong> to apply; edited
                    sprints/tasks get unchecked in the Execution tab.
                  </span>
                </p>
              )}

              <fieldset
                disabled={locked}
                className="min-w-0 border-0 m-0 p-0 disabled:opacity-60"
              >
                <PlanEditor value={draft} onChange={setDraft} />
              </fieldset>
            </>
          )}
        </div>
      </div>
      {taigaError && (
        <div role="alert" className="p-3 border border-red-300 bg-red-50 text-sm text-red-800">
          <p>{taigaError}</p>
          {taigaPreview?.errors?.length > 0 && (
            <ul className="list-disc pl-5 mt-2">
              {taigaPreview.errors.map((item: any, index: number) => (
                <li key={index}>{item.sourceId}: {item.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

// ===========================================================================
// Editable plan
// ===========================================================================

const PlanEditor: React.FC<{ value: SprintPlan; onChange: (p: SprintPlan) => void }> = ({
  value,
  onChange,
}) => {
  const set = (partial: Partial<SprintPlan>) => onChange({ ...value, ...partial });

  const setSprint = (i: number, s: PlanSprint) =>
    set({ sprints: value.sprints.map((x, idx) => (idx === i ? s : x)) });
  const addSprint = () =>
    set({ sprints: [...value.sprints, emptySprint(value.sprints.length + 1)] });
  const removeSprint = (i: number) =>
    set({
      sprints: value.sprints
        .filter((_, idx) => idx !== i)
        .map((s, idx) => ({ ...s, index: idx + 1 })),
    });

  return (
    <div className="space-y-4">
      <L label="Plan name *">
        <input
          value={value.planName}
          onChange={(e) => set({ planName: e.target.value })}
          placeholder="Sprint Plan — …"
          className="w-full bg-slate-50 border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:outline-none"
        />
      </L>
      <L label="Summary">
        <textarea
          value={value.summary}
          onChange={(e) => set({ summary: e.target.value })}
          rows={2}
          className="w-full bg-slate-50 border border-slate-300 px-2.5 py-1.5 text-[11px] font-mono text-slate-700 focus:outline-none resize-y min-h-[60px]"
        />
      </L>

      {(value.risks ?? []).some(r => r.severity === 'high' || r.severity === 'critical') && (
        <div role="status" className="border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <strong>Review before committing to these dates</strong>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            {(value.risks ?? []).filter(r => r.severity === 'high' || r.severity === 'critical').map((risk, i) => (
              <li key={i}>{risk.description}</li>
            ))}
          </ul>
        </div>
      )}

      {/* sprints */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Sprints ({value.sprints.length})
          </span>
          <button
            onClick={addSprint}
            className="flex items-center space-x-1 text-[10px] font-bold text-indigo-600 hover:underline uppercase tracking-wider"
          >
            <Plus className="w-3 h-3" />
            <span>Add sprint</span>
          </button>
        </div>
        {value.sprints.map((s, i) => (
          <SprintEditor
            key={i}
            sprint={s}
            onChange={(next) => setSprint(i, next)}
            onRemove={() => removeSprint(i)}
            canRemove={value.sprints.length > 1}
          />
        ))}
      </div>

      <ListEditor<PlanMilestone>
        icon={Flag}
        title="Milestones"
        rows={value.milestones ?? []}
        onChange={(milestones) => set({ milestones })}
        blank={{ name: '', date: '', description: '' }}
        fields={[
          { key: 'name', placeholder: 'Milestone', kind: 'text', grow: true },
          { key: 'date', placeholder: '', kind: 'date' },
        ]}
      />

      <ListEditor<PlanDeadline>
        icon={CalendarClock}
        title="Deadlines"
        rows={value.deadlines ?? []}
        onChange={(deadlines) => set({ deadlines })}
        blank={{ label: '', date: '' }}
        fields={[
          { key: 'label', placeholder: 'Deadline', kind: 'text', grow: true },
          { key: 'date', placeholder: '', kind: 'date' },
        ]}
      />

      <ListEditor<PlanRisk>
        icon={AlertTriangle}
        title="Risks"
        rows={value.risks ?? []}
        onChange={(risks) => set({ risks })}
        blank={{ description: '', severity: 'medium', mitigation: '' }}
        fields={[
          { key: 'description', placeholder: 'Risk', kind: 'text', grow: true },
          { key: 'severity', placeholder: '', kind: 'select', options: SEVERITIES },
          { key: 'mitigation', placeholder: 'Mitigation', kind: 'text', grow: true },
        ]}
      />

      <L label="Assumptions (one per line)">
        <textarea
          value={(value.assumptions ?? []).join('\n')}
          onChange={(e) =>
            set({ assumptions: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })
          }
          rows={3}
          className="w-full bg-slate-50 border border-slate-300 px-2.5 py-1.5 text-[11px] font-mono text-slate-700 focus:outline-none resize-y min-h-[60px]"
        />
      </L>
    </div>
  );
};

const SprintEditor: React.FC<{
  sprint: PlanSprint;
  onChange: (s: PlanSprint) => void;
  onRemove: () => void;
  canRemove: boolean;
}> = ({ sprint, onChange, onRemove, canRemove }) => {
  const set = (partial: Partial<PlanSprint>) => onChange({ ...sprint, ...partial });
  const setTask = (i: number, t: PlanTask) =>
    set({ tasks: sprint.tasks.map((x, idx) => (idx === i ? t : x)) });

  return (
    <div className="border border-slate-200 bg-slate-50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          value={sprint.name}
          onChange={(e) => set({ name: e.target.value })}
          className="flex-1 bg-white border border-slate-300 px-2 py-1 text-xs font-bold text-slate-900 focus:outline-none"
        />
        <input
          type="number"
          min={0}
          value={sprint.plannedPoints ?? ''}
          onChange={(e) =>
            set({ plannedPoints: e.target.value === '' ? undefined : Number(e.target.value) })
          }
          placeholder="s.pt"
          className="w-16 bg-white border border-slate-300 px-2 py-1 text-xs font-mono text-slate-800 focus:outline-none"
        />
        <button
          onClick={onRemove}
          disabled={!canRemove}
          title={canRemove ? 'Remove sprint' : 'A plan must keep at least one sprint'}
          className="disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-3.5 h-3.5 text-rose-600" />
        </button>
      </div>

      <input
        value={sprint.goal ?? ''}
        onChange={(e) => set({ goal: e.target.value })}
        placeholder="Sprint goal"
        className="w-full bg-white border border-slate-300 px-2 py-1 text-[11px] font-mono text-slate-700 focus:outline-none"
      />

      <div className="grid grid-cols-3 gap-2">
        <DateField label="Start" value={sprint.startDate} onChange={(startDate) => set({ startDate })} />
        <DateField label="End" value={sprint.endDate} onChange={(endDate) => set({ endDate })} />
        <DateField
          label="Deadline"
          value={sprint.deadline}
          onChange={(deadline) => set({ deadline })}
        />
      </div>

      {/* tasks */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
            Tasks ({sprint.tasks.length})
          </span>
          <button
            onClick={() => set({ tasks: [...sprint.tasks, emptyTask()] })}
            className="flex items-center space-x-1 text-[9px] font-bold text-indigo-600 hover:underline uppercase tracking-wider"
          >
            <Plus className="w-3 h-3" />
            <span>Add task</span>
          </button>
        </div>
        {sprint.tasks.map((t, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1 bg-white border border-slate-200 p-1.5">
            <input
              value={t.title}
              onChange={(e) => setTask(i, { ...t, title: e.target.value })}
              placeholder="Task title"
              className="flex-1 min-w-[120px] border border-slate-200 px-1.5 py-0.5 text-[10px] font-mono text-slate-700 focus:outline-none"
            />
            <select
              value={t.assigneeRole ?? ''}
              onChange={(e) => setTask(i, { ...t, assigneeRole: e.target.value })}
              className="border border-slate-200 px-1 py-0.5 text-[10px] font-mono text-slate-600 focus:outline-none"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r || 'role'}
                </option>
              ))}
            </select>
            <select
              value={t.priority ?? 'medium'}
              onChange={(e) => setTask(i, { ...t, priority: e.target.value })}
              className="border border-slate-200 px-1 py-0.5 text-[10px] font-mono text-slate-600 focus:outline-none"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              value={t.storyPoints ?? ''}
              onChange={(e) =>
                setTask(i, {
                  ...t,
                  storyPoints: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
              placeholder="s.pt"
              className="w-12 border border-slate-200 px-1 py-0.5 text-[10px] font-mono text-slate-600 focus:outline-none"
            />
            <input
              type="number"
              min={0}
              value={t.estimateHours ?? ''}
              onChange={(e) =>
                setTask(i, {
                  ...t,
                  estimateHours: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
              placeholder="est.hr"
              className="w-12 border border-slate-200 px-1 py-0.5 text-[10px] font-mono text-slate-600 focus:outline-none"
            />
            <button
              onClick={() => set({ tasks: sprint.tasks.filter((_, idx) => idx !== i) })}
              title="Remove task"
            >
              <X className="w-3 h-3 text-rose-500" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Generic repeatable-row editor for milestones / deadlines / risks
// ---------------------------------------------------------------------------

type FieldSpec = {
  key: string;
  placeholder: string;
  kind: 'text' | 'date' | 'select';
  options?: string[];
  grow?: boolean;
};

function ListEditor<T extends Record<string, any>>({
  icon: Icon,
  title,
  rows,
  onChange,
  blank,
  fields,
}: {
  icon: React.ElementType;
  title: string;
  rows: T[];
  onChange: (rows: T[]) => void;
  blank: T;
  fields: FieldSpec[];
}) {
  const setRow = (i: number, patch: Partial<T>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
          <Icon className="w-3 h-3" />
          <span>
            {title} ({rows.length})
          </span>
        </div>
        <button
          onClick={() => onChange([...rows, { ...blank }])}
          className="flex items-center space-x-1 text-[10px] font-bold text-indigo-600 hover:underline uppercase tracking-wider"
        >
          <Plus className="w-3 h-3" />
          <span>Add</span>
        </button>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1 bg-slate-50 border border-slate-200 p-1.5">
          {fields.map((f) => {
            const common =
              'border border-slate-200 px-1.5 py-0.5 text-[10px] font-mono text-slate-700 focus:outline-none bg-white';
            if (f.kind === 'select') {
              return (
                <select
                  key={f.key}
                  value={r[f.key] ?? ''}
                  onChange={(e) => setRow(i, { [f.key]: e.target.value } as Partial<T>)}
                  className={common}
                >
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              );
            }
            return (
              <input
                key={f.key}
                type={f.kind === 'date' ? 'date' : 'text'}
                value={r[f.key] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setRow(i, { [f.key]: e.target.value } as Partial<T>)}
                className={`${common} ${f.grow ? 'flex-1 min-w-[120px]' : ''}`}
              />
            );
          })}
          <button onClick={() => onChange(rows.filter((_, idx) => idx !== i))} title="Remove">
            <X className="w-3 h-3 text-rose-500" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

const L: React.FC<{
  label: string;
  optional?: boolean;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, optional, hint, children }) => (
  <label className="block">
    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
      {label}
      {optional && <span className="font-normal text-slate-400"> (optional)</span>}
    </span>
    {children}
    {hint && <span className="text-[9px] font-mono text-slate-400 block mt-1">{hint}</span>}
  </label>
);

const DateField: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({
  label,
  value,
  onChange,
}) => (
  <label className="block">
    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">
      {label}
    </span>
    <input
      type="date"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-white border border-slate-300 px-1.5 py-1 text-[10px] font-mono text-slate-800 focus:outline-none"
    />
  </label>
);

const NumberInput: React.FC<{
  value: number | null; // null = empty -> let the AI decide
  min?: number;
  onChange: (n: number | null) => void;
}> = ({ value, min = 0, onChange }) => (
  <input
    type="number"
    min={min}
    value={value == null ? '' : String(value)}
    placeholder="AI decides"
    onChange={(e) => {
      const raw = e.target.value;
      if (raw === '') {
        onChange(null);
        return;
      }
      const n = Number(raw);
      if (Number.isFinite(n) && n >= min) onChange(n);
    }}
    className="w-full bg-slate-50 border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-slate-800 focus:outline-none"
  />
);

/** A labeled department headcount input (part of the team-breakdown block). */
const DeptField: React.FC<{
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
}> = ({ label, value, onChange }) => (
  <label className="block">
    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">
      {label}
    </span>
    <NumberInput value={value} min={0} onChange={onChange} />
  </label>
);

const ProviderBadge: React.FC<{ provider?: string; compact?: boolean }> = ({ provider, compact }) => {
  const fallback = provider === 'heuristic-fallback' || provider === 'rule-based';
  const label = fallback ? 'Fallback' : 'AI generated';
  const cls = fallback
    ? 'bg-amber-100 text-amber-800 border-amber-300'
    : 'bg-emerald-100 text-emerald-800 border-emerald-300';
  return (
    <span
      className={`text-[9px] font-mono font-bold uppercase border px-1.5 ${cls} ${
        compact ? 'py-0' : 'py-0.5'
      }`}
    >
      {compact ? (fallback ? 'FB' : 'AI') : label}
    </span>
  );
};
