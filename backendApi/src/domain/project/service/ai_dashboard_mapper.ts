export const REPORT_DASHBOARD_FIELDS = [
  'report.project', 'report.generatedBy', 'report.generatedAt',
  'executiveSummary.overallProgress', 'executiveSummary.remainingProgress',
  'planAndActual.completePercent', 'planAndActual.remainingPercent', 'planAndActual.calculationBasis',
  'workBreakdown.totalTasks', 'workBreakdown.completed', 'workBreakdown.inProgress', 'workBreakdown.blocked',
  'workBreakdown.notStarted', 'workBreakdown.byFeature.status',
  'healthAndTrend.healthScore', 'healthAndTrend.overallHealth', 'healthAndTrend.trend', 'healthAndTrend.previousScore',
  'velocityAndSprint.velocity', 'velocityAndSprint.previousVelocity', 'velocityAndSprint.velocityTrend',
  'velocityAndSprint.sprintName', 'velocityAndSprint.completionRate',
  'risksAndPredictions.overallRisk', 'risksAndPredictions.deadlineRisk', 'risksAndPredictions.risks',
  'risksAndPredictions.predictions',
  'aiNarrative.summary', 'aiNarrative.whatNeedsAttention', 'aiNarrative.recommendations',
];

const num = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = new Date(value as any);
  return Number.isNaN(date.getTime()) ? null : date;
};

const FEATURE_STATUSES = ['implemented', 'partial', 'not_implemented', 'unknown'] as const;

export function toDashboardCard(project: any, reportRecord: any | undefined) {
  const projectId = String(project._id);
  const base = { project: { id: projectId, name: project.name ?? null, status: project.status ?? null } };
  const data = reportRecord?.report_data;
  const isSprintReport = data?.report?.type === 'sprint_review' || reportRecord?.definition?.report_type === 'sprint';
  if (!data || isSprintReport) {
    return {
      ...base,
      report: { id: null, name: null, status: 'missing', generated_at: null, generated_by: null, stale: false },
      implementation: null, health: null, velocity: null, risk: null, forecast: null, summary: null,
    };
  }

  const generatedAt = toDate(reportRecord.generated_at) || toDate(data.report?.generatedAt) || toDate(reportRecord.updated_at);
  const changedAt = toDate(project.report_data_changed_at);
  const plan = data.planAndActual || {};
  const summary = data.executiveSummary || {};
  const work = data.workBreakdown || {};
  const health = data.healthAndTrend || {};
  const velocity = data.velocityAndSprint || {};
  const risks = data.risksAndPredictions || {};
  const predictions = risks.predictions || {};
  const narrative = data.aiNarrative || {};

  const features = Object.fromEntries(FEATURE_STATUSES.map(status => [status, 0])) as Record<string, number>;
  for (const feature of Array.isArray(work.byFeature) ? work.byFeature : []) {
    const status = FEATURE_STATUSES.includes(feature?.status) ? feature.status : 'unknown';
    features[status] += 1;
  }

  const complete = num(plan.completePercent) ?? num(summary.overallProgress);
  const remaining = num(plan.remainingPercent) ?? num(summary.remainingProgress) ?? (complete == null ? null : round1(100 - complete));

  return {
    ...base,
    project: { id: projectId, name: data.report?.project?.name || project.name || null, status: project.status ?? null },
    report: {
      id: String(reportRecord._id),
      name: reportRecord.name ?? null,
      status: reportRecord.status ?? null,
      generated_at: generatedAt ? generatedAt.toISOString() : null,
      generated_by: data.report?.generatedBy ?? null,
      stale: Boolean(changedAt && (!generatedAt || changedAt > generatedAt)),
    },
    implementation: {
      complete_percent: complete,
      remaining_percent: remaining,
      basis: plan.calculationBasis ?? null,
      tasks: {
        total: num(work.totalTasks) ?? 0,
        completed: num(work.completed) ?? 0,
        in_progress: num(work.inProgress) ?? 0,
        blocked: num(work.blocked) ?? 0,
        not_started: num(work.notStarted) ?? 0,
      },
      features,
    },
    health: {
      score: num(health.healthScore),
      status: health.overallHealth ?? 'unknown',
      trend: health.trend ?? 'unknown',
      previous_score: num(health.previousScore),
    },
    velocity: {
      value: num(velocity.velocity),
      previous: num(velocity.previousVelocity),
      trend: velocity.velocityTrend ?? 'unknown',
      sprint_name: velocity.sprintName ?? null,
      completion_rate: num(velocity.completionRate),
    },
    risk: {
      overall: risks.overallRisk ?? 'unknown',
      deadline: risks.deadlineRisk ?? 'unknown',
      top: (Array.isArray(risks.risks) ? risks.risks : []).slice(0, 3),
    },
    forecast: {
      deadline_probability: num(predictions.deadlineProbability),
      expected_completion_date: predictions.expectedCompletionDate ?? null,
    },
    summary: {
      text: narrative.summary ?? null,
      needs_attention: (Array.isArray(narrative.whatNeedsAttention) ? narrative.whatNeedsAttention : []).slice(0, 3),
      recommendations: (Array.isArray(narrative.recommendations) ? narrative.recommendations : []).slice(0, 3),
    },
  };
}

type DashboardCard = ReturnType<typeof toDashboardCard>;

const countBy = (values: string[]): Record<string, number> =>
  values.reduce((acc, value) => ({ ...acc, [value]: (acc[value] || 0) + 1 }), {} as Record<string, number>);

const average = (values: (number | null)[]): number | null => {
  const present = values.filter((value): value is number => value != null);
  return present.length ? round1(present.reduce((sum, value) => sum + value, 0) / present.length) : null;
};

export function sumDashboardCards(cards: DashboardCard[]) {
  // Portfolio averages describe work that is still underway. Completed,
  // archived and cancelled projects are excluded, as are projects whose latest
  // report already says implementation reached 100%.
  const finishedStatuses = new Set(['3', '4', '5', 'completed', 'archived', 'cancelled', 'achieved', 'done', 'closed']);
  const unfinished = cards.filter(card => {
    const status = String(card.project.status ?? '').trim().toLowerCase();
    return !finishedStatuses.has(status) && (card.implementation?.complete_percent ?? 0) < 100;
  });
  const reported = unfinished.filter(card => card.implementation);
  const tasks = { total: 0, completed: 0, in_progress: 0, blocked: 0, not_started: 0 };
  const features = Object.fromEntries(FEATURE_STATUSES.map(status => [status, 0])) as Record<string, number>;

  for (const card of reported) {
    const impl = card.implementation!;
    for (const key of Object.keys(tasks) as (keyof typeof tasks)[]) tasks[key] += impl.tasks[key];
    for (const status of FEATURE_STATUSES) features[status] += impl.features[status] || 0;
  }

  // Every unfinished project contributes equally; large projects must not
  // dominate the portfolio percentage merely because they contain more tasks.
  const completePercent = average(reported.map(card => card.implementation!.complete_percent));

  const completionDates = reported
    .map(card => toDate(card.forecast!.expected_completion_date))
    .filter((date): date is Date => date != null);

  return {
    reports: {
      total_projects: unfinished.length,
      with_report: reported.length,
      missing: unfinished.length - reported.length,
      stale: reported.filter(card => card.report.stale).length,
      generating: reported.filter(card => card.report.status === 'generating').length,
    },
    implementation: {
      complete_percent: completePercent,
      remaining_percent: completePercent == null ? null : round1(100 - completePercent),
      tasks,
      features,
    },
    health: {
      avg_score: average(reported.map(card => card.health!.score)),
      by_status: countBy(reported.map(card => String(card.health!.status))),
    },
    risk: {
      by_overall: countBy(reported.map(card => String(card.risk!.overall).toLowerCase())),
      by_deadline: countBy(reported.map(card => String(card.risk!.deadline).toLowerCase())),
    },
    forecast: {
      avg_deadline_probability: average(reported.map(card => card.forecast!.deadline_probability)),
      latest_expected_completion_date: completionDates.length
        ? new Date(Math.max(...completionDates.map(date => date.getTime()))).toISOString()
        : null,
    },
  };
}
