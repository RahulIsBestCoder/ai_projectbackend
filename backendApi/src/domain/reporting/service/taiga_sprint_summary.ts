/** Exact counts from the synchronized Taiga task mirror; no AI estimates. */
export function buildTaigaSprintSummary(tasks: any[], sprints: any[]) {
  const groups = new Map<string, any>();
  const makeRow = (id: string | null, name: string, startDate: any = null) => ({
    milestoneId: id, sprintName: name, startDate, total: 0, closed: 0, blocked: 0,
    statuses: [] as Array<{ name: string; count: number }>,
  });
  for (const sprint of sprints) {
    if (sprint.is_deleted || sprint.taiga_milestone_id == null) continue;
    const id = String(sprint.taiga_milestone_id);
    groups.set(id, makeRow(id, sprint.name || `Sprint ${id}`, sprint.start_date));
  }
  const seen = new Set<string>();
  let lastSyncedAt: string | null = null;
  for (const task of tasks) {
    if (task.is_deleted) continue;
    if (task.taiga_task_id != null) {
      const identity = `${task.integration_id || task.taiga_project_id || ''}:${task.taiga_task_id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
    }
    const id = task.taiga_milestone_id == null ? null : String(task.taiga_milestone_id);
    const key = id || 'unassigned';
    if (!groups.has(key)) groups.set(key, makeRow(id,
      id ? task.taiga_milestone_slug || `Sprint ${id}` : 'No sprint assigned'));
    const row = groups.get(key);
    row.total++;
    if (task.is_closed === true) row.closed++;
    if (task.is_blocked === true) row.blocked++;
    const name = String(task.status_name || '').trim() || 'Unknown status';
    const status = row.statuses.find((item: any) => item.name === name);
    if (status) status.count++;
    else row.statuses.push({ name, count: 1 });
    const time = new Date(task.synced_at).getTime();
    if (Number.isFinite(time) && (!lastSyncedAt || time > new Date(lastSyncedAt).getTime())) lastSyncedAt = new Date(time).toISOString();
  }
  const rows = [...groups.values()].sort((a, b) => {
    if (a.milestoneId === null) return 1;
    if (b.milestoneId === null) return -1;
    return (new Date(a.startDate || 0).getTime() - new Date(b.startDate || 0).getTime())
      || a.sprintName.localeCompare(b.sprintName, undefined, { numeric: true });
  });
  for (const row of rows) row.statuses.sort((a: any, b: any) => a.name.localeCompare(b.name));
  return { source: 'taiga_tasks', lastSyncedAt, rows,
    totalTasks: rows.reduce((sum, row) => sum + row.total, 0),
    note: 'Counts reflect synchronized Taiga tasks at report generation. Blocked tasks are already included in their status counts.' };
}
