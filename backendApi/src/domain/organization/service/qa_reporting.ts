export type ReportingRole = 'qa' | 'manager';

export function reporterDepartmentName(roles: string[]): string {
  const manager = roles.includes('manager') || roles.includes('mixed');
  const qa = roles.includes('qa') || roles.includes('mixed');
  return manager ? (qa ? 'QA / Managers' : 'Managers') : 'QA / Testing';
}

export function reporterDepartmentDescription(roles: string[]): string {
  const name = reporterDepartmentName(roles);
  if (name === 'Managers') return 'Managers who create issues or tasks in Taiga. Excluded from QA efficiency.';
  if (name === 'QA / Managers') return 'QA reporters and managers who create issues or tasks in Taiga. Only QA reporters count toward QA efficiency.';
  return 'QA reporters who create issues or tasks in Taiga. Included in QA efficiency.';
}

export function reporterKey(username: unknown, ownerId: unknown): string {
  const login = String(username || '').trim().toLowerCase();
  return login ? `login:${login}` : ownerId != null ? `taiga:${ownerId}` : '';
}

/** Closure rate is a reporting metric, not a measure of an individual's productivity. */
export function qaEfficiency(reported: number, closed: number) {
  return {
    method: 'reported_item_closure_rate',
    reported, closed,
    percent: reported > 0 ? Math.round(closed / reported * 100) : null,
  };
}

export function eligibleReporting(role: ReportingRole, reported: number, closed: number) {
  return role === 'manager' ? { reported: 0, closed: 0 } : { reported, closed };
}
