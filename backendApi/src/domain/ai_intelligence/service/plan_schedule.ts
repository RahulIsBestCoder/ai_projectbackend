import { IPlanGenerate, ISprintPlan, IPlanSprint } from '../interface/ai_intelligence_interface';

const DAY = 86_400_000;
const dateText = (time: number) => new Date(time).toISOString().slice(0, 10);

function dateValue(value: unknown, field: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must be YYYY-MM-DD.`);
  const time = Date.parse(value);
  if (!Number.isFinite(time) || dateText(time) !== value) throw new Error(`${field} is not a valid date.`);
  return time;
}

export function validatePlanInput(input: IPlanGenerate): void {
  if (!input || typeof input.description !== 'string' || !input.description.trim()) throw new Error('description is required.');
  for (const [key, max] of [['duration_weeks', 104], ['sprint_length_weeks', 4], ['team_size', 1000]] as const) {
    const value = input[key];
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > max)) throw new Error(`${key} must be an integer from 1 to ${max}.`);
  }
  if (input.team_breakdown !== undefined) {
    if (!input.team_breakdown || typeof input.team_breakdown !== 'object' || Array.isArray(input.team_breakdown)) throw new Error('Invalid team breakdown.');
    let total = 0;
    for (const [key, value] of Object.entries(input.team_breakdown)) {
      if (!['ui', 'backend', 'app', 'others'].includes(key) || !Number.isInteger(value) || value < 0 || value > 1000) throw new Error('Team counts must be non-negative integers up to 1000.');
      total += value;
    }
    if (!total || total > 1000) throw new Error('Team breakdown must contain 1 to 1000 people.');
    if (input.team_size !== undefined && input.team_size !== total) throw new Error('Team size must match the department total.');
  }
  for (const key of ['features', 'constraints'] as const) {
    if (input[key] !== undefined && (!Array.isArray(input[key]) || input[key]!.some(value => typeof value !== 'string' || !value.trim()))) throw new Error(`${key} must contain non-empty strings.`);
  }
  const start = input.start_date === undefined ? dateValue(dateText(Date.now()), 'start_date') : dateValue(input.start_date, 'start_date');
  if (input.deadline !== undefined) {
    const end = dateValue(input.deadline, 'deadline');
    if (end < start) throw new Error('Deadline cannot be before the start date.');
    if ((end - start) / DAY + 1 > 104 * 7) throw new Error('Planning horizon cannot exceed 104 weeks.');
  }
}

export function planningCalendar(input: IPlanGenerate) {
  validatePlanInput(input);
  const teamSize = input.team_size || Object.values(input.team_breakdown || {}).reduce((sum, n) => sum + (n || 0), 0) || 4;
  const start = dateValue(input.start_date || dateText(Date.now()), 'start_date');
  const inferredWeeks = Math.min(104, Math.max(4, Math.ceil(((input.features?.length || 10) * 0.4 * 8) / teamSize)));
  const durationEnd = start + (input.duration_weeks || inferredWeeks) * 7 * DAY - DAY;
  const deadline = input.deadline === undefined ? undefined : dateValue(input.deadline, 'deadline');
  const end = deadline === undefined ? durationEnd : input.duration_weeks ? Math.min(durationEnd, deadline) : deadline;
  const days = Math.round((end - start) / DAY) + 1;
  const weeks = days / 7;
  const sprintWeeks = input.sprint_length_weeks || (weeks <= 6 ? 1 : weeks <= 12 ? 2 : 3);
  const count = Math.ceil(days / (sprintWeeks * 7));
  return { start, end, days, weeks, sprintWeeks, count, teamSize };
}

export function validPlanShape(plan: any): plan is ISprintPlan {
  return !!plan && typeof plan.plan_name === 'string' && !!plan.plan_name.trim()
    && typeof plan.summary === 'string' && Array.isArray(plan.sprints) && plan.sprints.length > 0
    && plan.sprints.length <= 104 && plan.sprints.every((s: any) => s && typeof s.name === 'string'
      && Array.isArray(s.tasks) && s.tasks.every((t: any) => t && typeof t.title === 'string' && t.title.trim()
        && ['estimate_hours', 'story_points'].every(key => t[key] === undefined || (typeof t[key] === 'number' && Number.isFinite(t[key]) && t[key] >= 0))))
    && plan.sprints.some((s: any) => s.tasks.length > 0)
    && (plan.milestones === undefined || (Array.isArray(plan.milestones) && plan.milestones.every((m: any) => m && typeof m.name === 'string')))
    && (plan.risks === undefined || (Array.isArray(plan.risks) && plan.risks.every((r: any) => r && typeof r.description === 'string')))
    && (plan.assumptions === undefined || (Array.isArray(plan.assumptions) && plan.assumptions.every((a: any) => typeof a === 'string')));
}

/** Calendar days define sprint boundaries; weekdays define indicative capacity. */
export function schedulePlan(plan: ISprintPlan, input: IPlanGenerate): ISprintPlan {
  const calendar = planningCalendar(input);
  if (!validPlanShape(plan)) throw new Error('Plan must contain named sprints and valid tasks.');
  const warnings: string[] = [];
  const tasks = plan.sprints.flatMap(s => s.tasks);
  let groups = plan.sprints;
  if (groups.length !== calendar.count) {
    // Preserve task order when an AI response uses the wrong number of sprints.
    groups = Array.from({ length: calendar.count }, (_, i) => ({
      name: `Sprint ${i + 1}`, goal: 'Complete the scheduled tasks',
      tasks: tasks.slice(Math.floor(i * tasks.length / calendar.count), Math.floor((i + 1) * tasks.length / calendar.count)),
    }));
    warnings.push('AI sprint count was adjusted to the requested calendar. Review task sequencing and dependencies.');
  }
  const sprints: IPlanSprint[] = groups.map((sprint, i) => {
    const start = calendar.start + i * calendar.sprintWeeks * 7 * DAY;
    const end = Math.min(calendar.end, start + calendar.sprintWeeks * 7 * DAY - DAY);
    let workdays = 0;
    for (let day = start; day <= end; day += DAY) {
      const weekday = new Date(day).getUTCDay();
      if (weekday !== 0 && weekday !== 6) workdays++;
    }
    // 6 productive hours per weekday leaves room for meetings and review.
    const capacity = workdays * 6 * calendar.teamSize;
    const estimated = sprint.tasks.reduce((sum, t) => sum + (t.estimate_hours || 0), 0);
    if (estimated > capacity) warnings.push(`${sprint.name}: ${estimated} estimated hours exceed ${capacity} available hours. Reduce scope, add capacity, or extend the schedule.`);
    if (!sprint.tasks.length) warnings.push(`${sprint.name}: no work is assigned; review the schedule.`);
    if (sprint.tasks.some(t => !t.estimate_hours)) warnings.push(`${sprint.name}: missing or zero estimates prevent a complete capacity check.`);
    if (input.team_breakdown) {
      const roles: Record<string, string> = { frontend: 'ui', design: 'ui', ui: 'ui', backend: 'backend', app: 'app', mobile: 'app', qa: 'others', devops: 'others' };
      const hours: Record<string, number> = {};
      for (const task of sprint.tasks) {
        const department = roles[String(task.assignee_role || '').toLowerCase()];
        if (department) hours[department] = (hours[department] || 0) + (task.estimate_hours || 0);
      }
      for (const [department, estimate] of Object.entries(hours)) {
        const available = workdays * 6 * (input.team_breakdown[department as keyof typeof input.team_breakdown] || 0);
        if (estimate > available) warnings.push(`${sprint.name}: ${department} needs ${estimate} hours but has ${available} hours available.`);
      }
    }
    return { ...sprint, index: i + 1, start_date: dateText(start), end_date: dateText(end), deadline: dateText(end),
      planned_points: sprint.tasks.reduce((sum, task) => sum + (task.story_points || 0), 0) };
  });
  const milestones = (plan.milestones || []).map((milestone, i, all) => {
    const index = Math.min(sprints.length - 1, Math.ceil((i + 1) * sprints.length / all.length) - 1);
    return { ...milestone, date: sprints[index].end_date };
  });
  const duration = Math.round(calendar.weeks * 100) / 100;
  const assumptions = [...(plan.assumptions || []),
    `Calendar: ${dateText(calendar.start)} to ${dateText(calendar.end)} inclusive; ${calendar.days} days; ${calendar.sprintWeeks}-week sprints, with the final sprint shortened if needed.`,
    `Capacity assumption: ${calendar.teamSize} people, 6 productive hours per weekday; holidays, leave, and individual availability require review.`,
    'Estimates and dependencies require team review; calendar fit is not a delivery guarantee.',
  ];
  if (input.features?.length) {
    const text = tasks.map(t => `${t.title} ${t.description || ''}`.toLowerCase()).join('\n');
    const unverified = input.features.filter(f => !text.includes(f.toLowerCase()));
    if (unverified.length) warnings.push(`Feature coverage needs review (features may be paraphrased): ${unverified.join('; ')}`);
  }
  if (plan.generated_by === 'dynamic-fallback') warnings.push('Fallback estimates are placeholders, not measured effort. Review all estimates before committing.');
  return { ...plan, summary: `${sprints.length} sprints over ${calendar.days} calendar days (${duration} weeks), ${dateText(calendar.start)} to ${dateText(calendar.end)}. Review task estimates and capacity warnings before committing.`,
    total_duration_weeks: duration, sprints, milestones,
    deadlines: [...sprints.map(s => ({ label: `${s.name} deadline`, date: s.end_date })),
      { label: 'Project deadline', date: input.deadline || dateText(calendar.end) }],
    assumptions, risks: [...(plan.risks || []), ...warnings.map(description => ({ description, severity: 'high', mitigation: 'Review and resolve before committing to this plan.' }))],
  };
}

/** Explicit targets win over older AI-generated deadline lists. */
export function projectPlanDeadline(record: any): Date | null {
  const explicit = record?.input?.deadline;
  if (explicit) {
    try { return new Date(dateValue(explicit, 'deadline')); } catch { /* legacy invalid date */ }
  }
  const ends = (record?.plan?.sprints || []).map((s: any) => s.end_date).filter(Boolean)
    .map((value: string) => Date.parse(value)).filter(Number.isFinite);
  if (ends.length) return new Date(Math.max(...ends));
  const dates = (record?.plan?.deadlines || []).map((d: any) => Date.parse(d.date)).filter(Number.isFinite);
  return dates.length ? new Date(Math.max(...dates)) : null;
}
