# Rule-based health score: UI instructions

For: the frontend developer working on `components/project/Health.tsx`.

The health section currently shows only the AI assessment, which returns `null` when it judges the evidence too thin ("Not enough evidence"). The backend can now also calculate health directly from delivery data using the scoring rule book — no AI call, same numbers every time. Add it next to the AI tiles so the section always explains the project's state.

## 1. Endpoint

```
GET /v1/projects/:projectId/health/rules-score
```

No body, no auth beyond the usual session. It calculates on request and stores nothing.

Response `data` (raw keys, snake_case):

```json
{
  "project": { "_id": "...", "name": "Mgroc demo 1" },
  "as_of": "2026-09-15",
  "calculation_version": "health-rules-v1",
  "rules_version": "1.0 proposed specification",
  "value": null,
  "band": "N/A",
  "status": "INSUFFICIENT_DATA",
  "provisional_score": 10.8,
  "provisional_band": "LOW",
  "coverage_weight": 0.5,
  "min_coverage": 0.7,
  "work_unit": "TAIGA_TASK_COUNT",
  "sections": {
    "feature":    { "score": null, "weight": 0.3,  "basis": "PLAN_SPRINT_SHARE",             "reason": "NOT_DUE" },
    "tasks":      { "score": 16.9, "weight": 0.2,  "basis": "DUE_DATE_OR_SPRINT_END",        "reason": null, "numerator": 10, "denominator": 59 },
    "sprint":     { "score": 10.2, "weight": 0.2,  "basis": "CLOSED_BY_SPRINT_END",          "reason": null, "denominator": 1 },
    "efficiency": { "score": null, "weight": 0.15, "basis": "ACTUAL_VS_ESTIMATED_HOURS",     "reason": "MISSING_ACTUAL_HOURS" },
    "evidence":   { "score": 0,    "weight": 0.1,  "basis": "COMMIT_DAYS_LAST_10_WORKING_DAYS", "reason": null, "numerator": 0, "denominator": 10 },
    "deadline":   { "score": null, "weight": 0.05, "basis": "ON_TIME_PROBABILITY",           "reason": "NO_REPRESENTATIVE_HISTORY" }
  },
  "reasons": ["FEATURE:NOT_DUE", "EFFICIENCY:MISSING_ACTUAL_HOURS", "DEADLINE:NO_REPRESENTATIVE_HISTORY"],
  "delivery_flags": ["PREDICTED_LATE"],
  "weights": { "feature": 0.3, "tasks": 0.2, "sprint": 0.2, "efficiency": 0.15, "evidence": 0.1, "deadline": 0.05 }
}
```

**The two scores, and why there are two**

| Field | Meaning | Show it as |
|---|---|---|
| `value` | Published score. Only set when the scored sections carry at least `min_coverage` of the weight **and** both Feature and Sprint scored. | The headline number. |
| `provisional_score` | The same weighted average over whatever scored, without that gate. Always set if at least one section scored. | A smaller number labelled "Provisional", never as the official score. |

For Mgroc demo 1 today, `value` is null (coverage 0.5 < 0.7, Feature not due) but `provisional_score` is 10.8 (LOW). So the tile can show "Provisional 10.8 — Low" plus the reasons, instead of a bare "Not enough evidence".

## 2. API client (`lib/api/analytics.ts`)

```ts
export interface RulesHealthSection {
  score: number | null;
  weight: number;
  basis: string;
  reason: string | null;
  numerator?: number;
  denominator?: number;
}

export interface RulesHealth {
  asOf: string;
  value: number | null;
  band: 'HIGH' | 'AVERAGE' | 'LOW' | 'N/A';
  status: 'FINAL' | 'PROVISIONAL' | 'INSUFFICIENT_DATA';
  provisionalScore: number | null;
  provisionalBand: 'HIGH' | 'AVERAGE' | 'LOW' | 'N/A';
  coverageWeight: number;
  minCoverage: number;
  workUnit: string;
  sections: Record<string, RulesHealthSection>;
  reasons: string[];
  deliveryFlags: string[];
  rulesVersion: string;
}

export async function getRulesHealth(projectId: string): Promise<RulesHealth | null> {
  return safeRead(async () => {
    const res = await http.get(`/projects/${projectId}/health/rules-score`);
    return oneOf<RulesHealth>(res.data);
  }, null, 'analytics.rulesHealth');
}
```

## 3. Health section (`components/project/Health.tsx`)

1. **Fetch it** alongside the existing health call and keep it in state.
2. **Add a "Rule-based health" tile** next to the AI Health and Quality tiles:
   - `value != null` → show it with its `band` (High / Average / Low), same styling as `ScoreTile`.
   - `value == null && provisionalScore != null` → show `provisionalScore` with `provisionalBand`, plus an amber "Provisional" badge. Under it: "Based on {round(coverageWeight*100)}% of the scoring weight".
   - both null → "Not enough evidence" (as now).
3. **Section breakdown**, collapsed by default. One row per section, ordered by weight descending:
   - name (table below), weight as a percentage, and the score or a dash
   - for scored sections with counts, show `numerator/denominator` (e.g. "10 / 59 resolved")
   - for null sections, show the reason text in grey
4. **Tooltip / info** on the headline: "Calculated from delivery data using the scoring rules, version {rulesVersion}. No AI."
5. **`delivery_flags`**: show `PREDICTED_LATE` as a red "Predicted late" chip; `HIGH_DEADLINE_RISK` as "Deadline at risk"; `OVERDUE` as "Overdue"; `ZERO_THROUGHPUT` as "No recent closures".

### Section names

| Key | Label | What it measures |
|---|---|---|
| `feature` | Feature delivery vs plan | Work done vs the share the plan had due by today |
| `tasks` | Task resolution | Items due by today (own due date, else sprint end) that are closed |
| `sprint` | Sprint completion | Items closed by their sprint's end date |
| `efficiency` | Work efficiency | Actual vs estimated hours (not tracked yet) |
| `evidence` | Code activity | Working days with commits, last 10 working days |
| `deadline` | Deadline feasibility | Simulated on-time probability |

### Reason text

`reasons` are `SECTION:CODE`. Map the code:

| Code | Text |
|---|---|
| NOT_DUE | Nothing due yet |
| NO_PLAN | No sprint plan |
| PLAN_NOT_ACCEPTED | Plan not accepted (using latest draft) |
| NO_COMMITTED_SCOPE | No work items |
| NO_DUE_DATES | No due dates or sprints on items |
| NO_SPRINT_COMMITMENT | Ended sprints have no items or points |
| MISSING_ACTUAL_HOURS | Actual hours not tracked |
| NO_REPOSITORY_DATA | No repository connected |
| NO_TARGET_DATE | No deadline set |
| NO_REPRESENTATIVE_HISTORY | Under 8 weeks of delivery history |
| ZERO_THROUGHPUT | Nothing closed in the last 20 working days |
| anything else | Show the code |

Keep `EFFICIENCY:MISSING_ACTUAL_HOURS` out of the headline summary — it is always present. Show it only in the breakdown row.

## 4. What this does not change

- The AI Health and Quality tiles, the strategies list, and the trend chart are untouched.
- Nothing is written to `analytics_snapshots`, so the Analytics tab's headline health still comes from the AI assessment.
- The score changes only when the underlying Taiga/Git/plan data changes; there is no cache to clear.

## 5. Checklist

- [ ] Project with no plan and no ended sprint: tile shows "Not enough evidence", breakdown lists the reasons.
- [ ] Mgroc demo 1: tile shows provisional 10.8 (Low) with the coverage line and the "Predicted late" chip.
- [ ] A project with an accepted plan past its first sprint: tile shows a real `value` with its band.
- [ ] Breakdown rows show counts for tasks and evidence.
- [ ] Reason codes render as text, not raw codes.
