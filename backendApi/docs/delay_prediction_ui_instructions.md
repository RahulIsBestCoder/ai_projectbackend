# Predictive Intelligence Center: API and UI instructions

For: the frontend developer working on `components/AiIntelligence.tsx` and `lib/api/risk.ts`.

Two new endpoints replace the client-side derivation in `runAIPrediction`. Every number is deterministic and comes from data already stored by the deadline forecast and risk analysis. No AI call, so responses are immediate and repeatable.

## 1. Baseline

```
GET /v1/projects/:projectId/ai/delay-prediction
```

Real response for Mgroc demo 1:

```json
{
  "delay_probability": 65,
  "verdict": "MODERATE_RISK",
  "predicted_finish_date": "2027-08-24",
  "target_date": "2027-05-08",
  "remaining_working_days": 245,
  "confidence": 56,
  "confidence_basis": "RISK_LEVEL_FALLBACK",
  "on_time_probability": null,
  "risk_level": "HIGH",
  "drivers": {
    "pr_review_latency_hours":        { "baseline": 5.8,  "source": "140 merged pull requests",      "reason": null },
    "sprint_velocity_deficit_percent":{ "baseline": 31.5, "source": "REQUIRED_VS_OBSERVED_VELOCITY", "reason": null },
    "critical_bugs":                  { "baseline": null, "source": null, "reason": "NO_BUG_SEVERITY_TRACKED" },
    "qa_capacity_percent":            { "baseline": null, "source": null, "reason": "NO_QA_ROLE_ON_PROJECT" }
  },
  "sensitivity": { "pr_review_latency_hours": { "max_points": 12, "reference": 48, "unit": "hours", "label": "PR review latency" }, "...": {} },
  "feature_importances": [
    { "feature": "PREDICTED_LATE", "weight": 80, "description": "Delivery forecast flag: PREDICTED_LATE.", "source": "forecast" },
    { "feature": "ai-1", "weight": 85, "description": "Active sprint is overdue while the project has no target date...", "source": "risk" }
  ],
  "recommendations": ["...", "..."],
  "risk_counts": { "CRITICAL": 1, "HIGH": 4, "MEDIUM": 8 },
  "reasons": ["PROBABILITY_FROM_RISK_LEVEL:HIGH", "NO_REPRESENTATIVE_HISTORY"]
}
```

**This fixes three bugs visible on the current screen:**

| Screen today | Cause | Now |
|---|---|---|
| "Invalid Date" | `toPrediction` read `predictedFinishDate`, backend sent `predicted_finish_date`, so `new Date('')` | `predicted_finish_date` is `YYYY-MM-DD` or `null` — never an empty string |
| "0%" delay | fell back to `analytics.delayProbability`, which is always 0 | `delay_probability` is always a number |
| "AI Confidence 0%" | `confidence_score` unset on the deadline row | `confidence` with a `confidence_basis` saying how it was derived |

`confidence_basis` is `FORECAST_DATA_QUALITY` when a simulated probability exists, or `RISK_LEVEL_FALLBACK` when the forecast had too little history (then `on_time_probability` is null). Show that distinction — do not present a fallback as a modelled probability.

## 2. Simulator

```
POST /v1/projects/:projectId/ai/delay-prediction/simulate
{ "pr_review_latency_hours": 40, "sprint_velocity_deficit_percent": 30, "critical_bugs": 3, "qa_capacity_percent": 50 }
```

Any subset of the four keys is allowed; omitted drivers keep their baseline. An empty body is rejected with a message naming the four keys.

```json
{
  "baseline":   { "delay_probability": 65, "predicted_finish_date": "2027-08-24", "confidence": 56 },
  "scenario":   { "delay_probability": 82.5, "delta_points": 17.5,
                  "predicted_finish_date": "2027-10-22", "shifted_working_days": 43,
                  "verdict": "HIGH_DELAY_RISK" },
  "contributions": [
    { "key": "pr_review_latency_hours",         "value": 40, "baseline": 5.8,  "points": 8.6, "direction": "increases", "basis": "12 pts at 48 hours" },
    { "key": "sprint_velocity_deficit_percent", "value": 30, "baseline": 31.5, "points": -0.3, "direction": "decreases", "basis": "22 pts at 100 percent" },
    { "key": "critical_bugs",                   "value": 3,  "baseline": null, "points": 4.2, "direction": "increases", "basis": "14 pts at 10 bugs" },
    { "key": "qa_capacity_percent",             "value": 50, "baseline": null, "points": 5,   "direction": "increases", "basis": "10 pts at 100 percent" }
  ]
}
```

Verified behaviour: best case (2h, 0%, 0 bugs, 100% QA) → **57.2%**, finish 19 working days earlier; 10 critical bugs alone → **79%**, 34 days later. Each driver moves the number only by how far it sits from its reference, so an untouched slider contributes 0.

## 3. API client (`lib/api/risk.ts`)

Replace `runAIPrediction`'s client-side derivation with these:

```ts
export async function getDelayPrediction(projectId: string) {
  return safeRead(async () => {
    const res = await http.get(`/projects/${projectId}/ai/delay-prediction`);
    return oneOf<any>(res.data);
  }, null, 'risk.delayPrediction');
}

export async function simulateDelay(projectId: string, drivers: Partial<Record<
  'prReviewLatencyHours' | 'sprintVelocityDeficitPercent' | 'criticalBugs' | 'qaCapacityPercent', number>>) {
  const res = await http.post(`/projects/${projectId}/ai/delay-prediction/simulate`, toApi(drivers));
  return fromApi(res.data);
}
```

`toApi` converts the camelCase keys to the snake_case the endpoint expects; `fromApi` camelCases the response.

## 4. `AiIntelligence.tsx`

1. **Fetch the baseline** on mount and after "Recalculate AI Model"; drop `analytics.delayProbability` as the fallback.
2. **Ring**: `delayProbability`, with the existing thresholds. Use `verdict` for the caption rather than recomputing it.
3. **Predicted Finish Date**: render `predictedFinishDate` directly. If null, show "No date — " plus the first entry of `reasons`. Never pass it to `new Date()` without a null check.
4. **AI Confidence**: `confidence`%, with a tooltip from `confidenceBasis` ("Derived from the forecast's data quality" / "Estimated from the stored risk level — not enough delivery history").
5. **Sliders**: initialise each from `drivers[key].baseline`. When the baseline is null, start at the neutral value (0 bugs, 100% QA), and label the slider "no data — what-if only" using `drivers[key].reason`:
   - `NO_BUG_SEVERITY_TRACKED` → "Bug severity is not tracked in Taiga"
   - `NO_QA_ROLE_ON_PROJECT` → "No QA role assigned on this project"
   - `NO_MERGED_PULL_REQUESTS` / `NO_VELOCITY_DATA` → "Not enough data"
6. **Simulate button**: call `simulateDelay` with the four values. Show `scenario.delayProbability` in the ring, `delta_points` as a signed badge ("+17.5 pts"), and `scenario.predictedFinishDate` with `shiftedWorkingDays` ("43 working days later"). Keep `baseline` visible so the comparison is obvious.
7. **XAI panel**: map `featureImportances` (`feature`, `weight`, `description`). Badge `source`: "forecast" vs "risk". After a simulation, prefer `contributions` — they are the actual per-driver points for the scenario shown.
8. **Action plan**: `recommendations` are the stored mitigations, already ordered by severity.

## 5. Notes

- Both endpoints are read-only. Neither runs a sync, an AI call, or writes rows, so they are safe to call on every slider release. Debounce ~300ms anyway.
- The numbers change only when `predictDeadline` / `analyzeRisks` run again (AI Sync, or the deadline route).
- `delay_probability` is capped at 98 and floored at 0.
- The `sensitivity` block documents each driver's weight, so the UI can show "max +12 pts" next to a slider without hardcoding it.

## 6. Overview banner (`GET /projects/:id/predictions`)

The Overview "AI predicted finish" banner reads the **stored** prediction, not the
deterministic endpoint above. The response was fixed to match the documented
contract (implementation plan P1-1):

- `predictions[]` is sorted newest first — take `predictions[0]`, or the new
  top-level `prediction` shortcut. Previously rows came back in insertion order,
  so projects with seeded history could show a stale date.
- Rows are plain objects now (no `_doc` wrapper), and include the non-schema
  fields `predictDeadline` stores: `on_time_probability`, `forecast_status`,
  `flags`, `data_quality_score`.
- `prediction.forecast_status` explains a missing date: `complete` / `forecast`
  (date present), `stalled` (ZERO_THROUGHPUT — nothing closed in the last 20
  working days, so no date), `insufficient_data` (no date). Unknown values are
  `null`, never `0` (e.g. `confidence` when `confidence_score` is unset).
- Field names are **snake_case**: there is no `predictedFinishDate`, no camelCase
  `predictedDate`, and no `completion_date`. Map through `fromApi` exactly like
  the baseline payload, or point Overview at
  `GET /projects/:id/ai/delay-prediction` and render `reasons` when the date is
  null.

## 7. Checklist

- [ ] Mgroc demo 1 shows 65%, finish 2027-08-24, confidence 56% — no "Invalid Date", no 0%
- [ ] Moving PR latency to 40h raises the number by ~8.6 pts
- [ ] Critical bugs and QA sliders move the number even though their baseline is null
- [ ] Resetting all four to baseline returns the number to 65%
- [ ] A project with no stored prediction shows the `NO_STORED_PREDICTION` reason rather than an empty panel
- [ ] Empty simulate body surfaces the backend's message
- [ ] Overview banner shows `predictions[0].predicted_finish_date` after one AI Sync, with the camelCased `fromApi` mapping
- [ ] A stalled project (`forecast_status: 'stalled'`) shows a "why" label instead of "Not synced yet"
