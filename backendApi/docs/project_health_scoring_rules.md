# AI Project Intelligence Platform — Health and Forecast Rules

Version: 1.0 proposed specification  
Status: Implementation scope; scoring weights and thresholds require validation against project history.

## 1. Purpose and AI scope

Calculate explainable project and department-level health from the project plan, Taiga, Git, review/test evidence, team availability, and delivery history. Show feature implementation, task resolution, sprint delivery, efficiency, deadline forecasts, and probability of meeting the target.

The calculation engine owns arithmetic, calendars, scoring, and simulation. AI proposes feature-to-code mappings, summarizes evidence, identifies missing information, and explains calculated results. AI must not invent hours, completion percentages, blockers, or probabilities.

Report backend, frontend, and QA separately when the plan supports those departments. Do not turn these metrics into employee rankings. A junior taking twice as long as a senior is a configurable planning assumption, not a measured fact about every junior.

## 2. Separate the four outputs

| Output | Meaning |
|---|---|
| Progress percentage | How much approved scope is accepted |
| Health score | How delivery compares with the agreed plan |
| On-time probability | Fraction of modeled outcomes finishing by the target |
| Data quality | How complete and trustworthy the inputs are |

A new project at 10% completion can be healthy if only 10% was due. A project can have excellent evidence that it will finish late. Therefore progress, health, probability, and data quality must remain separate.

## 3. Units and conventions

Use one consistent effort unit within each forecast. This specification uses base effort hours: estimated hours for the agreed reference capability, before assignee multipliers. They are estimates, not logged hours.

| Symbol | Definition | Unit |
|---|---|---|
| b_i | Baseline effort of independently verifiable work item i | Base hours |
| c_i | Accepted completion fraction from explicit milestones | 0–1 |
| p_i(t) | Planned accepted completion fraction by snapshot t | 0–1 |
| r_i | Updated estimate of remaining work, including known rework | Base hours |
| a_ij | Actual productive hours contributed by person j to item i | Actual hours |
| m_ij | Expected time multiplier for person j on item i | Positive ratio |
| h_j(d) | Available productive hours on working day d | Actual hours/day |
| R | Sum of remaining work | Base hours |
| V | Accepted output velocity | Base hours/working day |
| D | Available working days until target | Working days |

All scores are bounded to 0–100. All fraction inputs are bounded to 0–1. Preserve unrounded values for calculations; round scores to one decimal for display. A missing denominator returns N/A, not zero or 100.

## 4. Evidence and late Taiga updates

Each work item must have a stable ID, approved scope, acceptance criteria, department, baseline estimate, planned milestones, and source references.

Maintain separate states:

- **Reported state:** what Taiga currently says.
- **Observed implementation state:** what code, PRs, builds, and tests demonstrate.
- **Accepted state:** completion confirmed against acceptance criteria by the configured acceptance authority or automated acceptance gate.

A commit or merge alone does not prove that a feature works. AI should inspect relevant changes and acceptance criteria, not infer progress from commit messages, changed-line counts, or file presence alone.

When Taiga is stale, show implementation evidence and a synchronization warning. Count accepted work if the configured acceptance gate is satisfied, even if Taiga has not yet been updated. Preserve the discrepancy; do not silently overwrite either source.

Default completion is binary: c_i = 1 only when accepted, otherwise 0. Partial completion is allowed only for predefined independently accepted milestones with frozen weights summing to 1. Arbitrary mappings such as “in progress = 50%” may be workflow indicators, but must not feed accepted effort or deadline velocity.

AI-generated mappings need evidence references and a review state. Unsupported mappings stay unverified. Avoid counting a parent feature and its child tasks as separate delivered effort.

## 5. Default score bands and weights

These are proposed product rules, not statistically established thresholds.

| Score | Health band |
|---|---|
| 0 ≤ score < 40 | LOW |
| 40 ≤ score < 70 | AVERAGE |
| 70 ≤ score ≤ 100 | HIGH |
| Insufficient input | N/A |

| Section | Weight |
|---|---:|
| Feature delivery versus plan | 30% |
| Taiga task resolution versus plan | 20% |
| Sprint completion by planned date | 20% |
| Work efficiency | 15% |
| Implementation evidence coverage | 10% |
| Deadline feasibility | 5% |

Feature and task scores overlap; these weights represent a dashboard policy, not independent statistical evidence. Version any weight changes.

## 6. Feature implementation and health

For all approved feature milestones:

```text
Accepted effort C = Σ(b_i × c_i)
Approved baseline effort P = Σb_i
Feature progress percent = 100 × C / P
Planned accepted effort at snapshot t = Σ(b_i × p_i(t))
Feature health score = min(100, 100 × C / PlannedAcceptedEffort(t))
```

Use the actual milestone plan, not a straight-line assumption unless explicitly configured. If nothing is due yet, health is N/A with reason NOT_DUE; still show progress.

Example: total scope 500 hours, 100 accepted, 100 planned by today. Progress is 20%; feature health is 100. This prevents early projects being labeled unhealthy just because they are unfinished.

Report overdue mandatory features separately. Use a consistent approved weighting basis; do not multiply effort by an undocumented importance factor.

## 7. Taiga task-solving score

Use a frozen planned cohort of tasks or bug fixes for the reporting period. Score accepted resolutions against what was due by the snapshot.

```text
Task resolution score = min(100,
  100 × AcceptedEffortInCohort / PlannedAcceptedEffortInCohortByToday)
Task completion percent = 100 × AcceptedTaskCount / PlannedTaskCount
```

If effort is unavailable, an explicitly labeled count-based score may be used for reasonably similar tasks. Do not mix count-based and effort-based histories without a model/version change.

A reopened task loses acceptance credit when acceptance is revoked. Track added rework separately so it is not counted twice. Show reopened count, overdue count, blocker age, and median resolution time as diagnostics. Do not infer labor hours from creation-to-close duration.

Taiga status completeness and source freshness belong to data quality. Late status entry should create a discrepancy warning rather than erase verified accepted delivery.

## 8. Sprint planned-date completion

For each ended sprint s, freeze its originally committed scope and deadline:

```text
OnTimeEffort_s = committed effort accepted by original sprint deadline
SprintOnTimeScore_s = 100 × OnTimeEffort_s / OriginalCommittedEffort_s
HistoricalSprintScore = 100 × ΣOnTimeEffort_s / ΣOriginalCommittedEffort_s
```

Completion after the deadline must not retroactively improve the on-time score. Record scope additions, removals, and approved replans separately. Keep both original commitment performance and current-plan performance.

For an active sprint:

```text
ActiveSprintPaceScore = min(100,
  100 × AcceptedCommittedEffortNow / PlannedAcceptedCommittedEffortNow)
```

If no explicit milestone curve exists, linear planned completion may be used as a labeled assumption. Default: suppress the active pace score until at least 20% of sprint working time has elapsed and some work was planned to be accepted.

Use the active score for the current health composite when eligible. Otherwise use the last three ended sprints' effort-weighted on-time score, labeled with its period. If neither exists, return N/A. Never blend these two meanings without displaying the rule.

## 9. Junior/senior normalization and efficiency

Configured example defaults:

| Planning capability | Time multiplier |
|---|---:|
| Senior/reference | 1.0 |
| Mid-level | 1.5 |
| Junior | 2.0 |

Multipliers should reflect task type and verified experience when available. Keep them fixed for an evaluation period; changing the multiplier after seeing actual time would make the score circular.

For a single assignee:

```text
Expected actual hours_i = b_i × m_i
Efficiency_i = ExpectedActualHours_i / ActualHours_i
```

For comparable completed items and mixed contributors, use a consistent base-unit formulation:

```text
Normalized actual effort_i = Σ_j(a_ij / m_ij)
Team efficiency E = Σ_i b_i / Σ_i NormalizedActualEffort_i
Efficiency score = min(100, 100 × E)
```

This weights the ratio by normalized effort rather than averaging task percentages. Include all contributors and rework hours for the accepted work. Use only items with credible actual-hour records. Publish eligible effort coverage and open-work age so completed-task selection does not hide unfinished work.

Example: a 10-base-hour task assigned to a junior with m = 2 has an expected duration of 20 actual hours.

| Actual junior hours | Normalized actual hours | Raw efficiency | Score |
|---|---:|---:|---:|
| 18 | 9 | 111.1% | 100 |
| 20 | 10 | 100% | 100 |
| 24 | 12 | 83.3% | 83.3 |

Retain raw efficiency above 100% for planning; only the dashboard score is capped. Efficiency measures performance relative to estimates and assumptions, not overall developer quality.

If actual hours are absent, efficiency is N/A. Git timestamps and Taiga elapsed time must not substitute for productive hours.

## 10. Implementation evidence score

Measure evidence coverage for items claiming implementation, not developer activity volume.

```text
Evidence score = 100 ×
  ClaimedImplementedEffortWithVerifiedEvidence /
  TotalClaimedImplementedEffort
```

Verification requires the configured evidence checklist: relevant code mapping, required integration/merge state, and required review/test records. Missing test records are not passing tests. Code evidence coverage is not test coverage.

If no work claims implementation, return N/A. Documentation-only work may use its own acceptance evidence. Display unverified claims, contradictory sources, and evidence freshness.

## 11. Remaining work

```text
R = Σr_i
```

Prefer a current estimate to complete. If unavailable, use r_i = b_i × (1 − c_i) and label it BASELINE_FALLBACK. Add approved new scope and known rework exactly once. Do not assume that half the elapsed time means half the work remains.

Keep baseline scope and current scope separately. Report scope growth rather than rewriting historical snapshots.

## 12. Deadline forecast — choose one model

### A. Observed delivery model

Use accepted base effort delivered during a representative recent period, including working days with zero delivery:

```text
Observed velocity V_obs = AcceptedBaseEffortInWindow / WorkingDaysInWindow
Predicted remaining working days = R / V_obs
```

Default candidate window: last 20 working days. Publish window length, number of accepted items, team changes, and scope comparability. These are configurable policy settings.

Observed velocity already includes historical delivery performance. **Do not multiply it by efficiency or apply junior multipliers again.**

### B. Capacity model when observed history is inadequate

For stable, interchangeable work and compatible team composition:

```text
Base capacity K(d) = Σ_j(h_j(d) / m_j)
Effective capacity V_cap(d) = K(d) × E
```

Use E from comparable completed work. If E is unavailable, E = 1 may be an explicit scenario assumption, never a measured efficiency.

Find the first working day n for which:

```text
Σ(d=1..n) V_cap(d) ≥ R
```

For constant capacity, n = ceil(R / (K × E)). Productive hours must already reflect leave, allocation, meetings, and mentoring time; avoid deducting the same loss twice.

### Assignment and dependency constraints

Aggregate capacity is a rough forecast, not a scheduling guarantee. A frontend developer cannot automatically absorb QA or backend work. For constrained projects, estimate each remaining task's duration using compatible capacity and schedule it only after dependencies finish and required people are available.

```text
TaskStart_i = first feasible resource slot after all predecessors finish
TaskFinish_i = TaskStart_i + scheduled remaining task duration
ProjectFinish = latest finish among required release tasks
```

Respect working calendars, concurrency limits, reviews, QA, external waits, release gates, and holidays. Parallel departments finish at the maximum of their finish times only if independent. Sequential dependencies require scheduling. If dependencies are unknown, label the aggregate forecast APPROXIMATE.

## 13. Dates, slack, and deterministic feasibility

Use a configured project timezone and holiday calendar. The default snapshot is end of a working day; count future working days from the next working day through the target date inclusively. For intraday snapshots, explicitly account for remaining hours.

```text
Required velocity = R / D                         (D > 0)
Slack working days = D − PredictedRemainingDays
Capacity ratio = D / PredictedRemainingDays        (prediction > 0)
```

Display these deterministic quantities directly. Capacity ratio is not a probability. If the predicted finish is after the target, always show PREDICTED_LATE regardless of the overall score.

## 14. Probability of meeting the deadline

Use simulated completion outcomes when there is enough representative history. Do not use “1 − average estimation error” or a weighted health score as a probability.

Proposed implementation:

1. Freeze the scope, snapshot, working calendar, dependencies, and model version.
2. Generate M = 10,000 scenarios with a recorded random seed.
3. For the observed model, resample comparable whole weekly blocks of accepted throughput, preserving zero-output periods. Use enough blocks for the forecast horizon. This is an aggregate model and assumes future throughput is comparable.
4. For a dependency-aware capacity model, sample positive task-effort error ratios from comparable history and schedule resource-constrained tasks. Include shared disruptions coherently; do not assume every task risk is independent.
5. Model known scope-change and external-delay scenarios explicitly. State whether the forecast assumes fixed scope. Do not add a second productivity penalty for risks already reflected in the sampled throughput.
6. Record each simulated completion date F_k. Runs unfinished at the configured horizon count as misses for targets inside that horizon; preserve them as censored outcomes.

```text
P(on time) = count(F_k ≤ TargetDate) / M
P50 finish = median simulated finish date
P80 finish = 80th percentile simulated finish date
P10–P90 range = central 80% modeled prediction interval
Deadline health score = 100 × P(on time)
```

If a percentile lies beyond the simulation horizon, report BEYOND_HORIZON rather than dropping incomplete runs. The modeled probability is conditional on assumptions, not a guarantee. More simulations reduce numerical noise, not missing-data or model error.

Proposed minimum for an empirical throughput forecast: eight comparable historical weekly blocks and twenty accepted items. Below that, show scenario dates and probability = null, or explicitly label a separately supplied probability model ASSUMPTION_BASED. These minimums are product gates, not proof of statistical reliability.

Validate using past snapshots without future-data leakage. Track whether P80 dates cover roughly 80% of observed finishes, forecast error by horizon, and probability calibration. Reassess after major team or scope changes. An unvalidated model must display UNCALIBRATED.

## 15. Data quality, distinct from probability

Compute each component in 0–1, using effort weighting where possible:

```text
Q = 100 × (0.30 × EstimateCoverage
         + 0.30 × AcceptanceEvidenceCoverage
         + 0.20 × RequiredSourceFreshness
         + 0.20 × HistorySufficiency)
```

- EstimateCoverage: in-scope work with usable estimates divided by in-scope work. If estimates are missing, use item-count coverage and label the basis; do not estimate missing weights silently.
- AcceptanceEvidenceCoverage: claimed accepted effort with verifiable acceptance divided by claimed accepted effort.
- RequiredSourceFreshness: required sources successfully synchronized within a configured 24-hour freshness window divided by required sources.
- HistorySufficiency: min(1, comparable weekly blocks / 8).

If a component is not applicable, renormalize the applicable weights and report coverage. If unavailable, flag it as unknown and do not silently treat it as applicable full credit. A source that synchronizes successfully may still contain stale human updates; show discrepancy counts separately.

Label this DATA_QUALITY_SCORE, never “deadline confidence.” Show model calibration status alongside it.

## 16. Overall score, missing metrics, and critical risks

For available sections J:

```text
ScoreCoverage = Σ_j∈J weight_j
OverallHealth = Σ_j∈J(weight_j × score_j) / ScoreCoverage
```

Default publication rule: require at least 70% section-weight coverage, including feature and sprint sections. Otherwise return overall score = null and INSUFFICIENT_DATA. Missing efficiency or probability must never become a fabricated value.

If sufficient coverage exists but any section is missing, label the result PROVISIONAL. Preserve both the raw score band and delivery risk; a weighted average must not suppress critical warnings.

Critical flags include:

- Predicted finish after target: PREDICTED_LATE.
- Modeled on-time probability below 40%: HIGH_DEADLINE_RISK.
- Required release blocker with no resolution date: UNBOUNDED_BLOCKER.
- Overdue mandatory acceptance milestone: CRITICAL_MILESTONE_OVERDUE.
- Contradictory acceptance evidence: ACCEPTANCE_CONFLICT.

An unresolved release blocker may make the forecast unavailable. Show “HIGH score — delivery at risk” when appropriate; never present an unconditional green status. Low total progress alone does not trigger a critical risk.

Compare health trends only across compatible scope, weights, metric coverage, and calculation versions. Otherwise label the periods NOT_COMPARABLE.

## 17. Worked examples

### Capacity with one senior and one junior

Assume 6 productive hours each per day, multipliers 1 and 2, normalized historical efficiency 0.90, 90 base hours remaining, and 12 working days available.

```text
K = 6/1 + 6/2 = 9 base hours/day
V_cap = 9 × 0.90 = 8.1 base hours/day
Remaining duration = 90/8.1 = 11.111... working days
Rounded forecast = 12 working days
Slack = 12 − 12 = 0 working days
```

This is a tight deterministic forecast. It does not imply 100% confidence. It assumes compatible parallel work and no additional dependency bottleneck.

If instead observed accepted velocity is 8 base hours/day, model A gives 90/8 = 11.25, rounded to 12 days. Do not apply 0.90 again.

### Health composite

Suppose measured section scores are feature 80, tasks 75, sprint 65, efficiency 88, evidence 82, and deadline 70. Here deadline 70 means 70% of valid simulation outcomes met the target.

```text
Overall = 0.30×80 + 0.20×75 + 0.20×65
        + 0.15×88 + 0.10×82 + 0.05×70
        = 76.9 → HIGH
```

The pasted draft's result of 76.1 for these inputs was an arithmetic error. The overall 76.9 is not a 76.9% probability of success.

## 18. Required stored inputs and outputs

Store immutable calculation snapshots containing:

- Project and snapshot IDs, timezone, calendars, target, scope version, and original sprint commitments.
- Work-item IDs, departments, dependencies, approved estimates, remaining estimates, milestones, acceptance timestamps, and evidence references.
- Source-reported states, observed states, synchronization timestamps, and unresolved discrepancies.
- Actual-hour records where available, contributor allocation, multiplier assumptions, and historical-window selection.
- Every section's numerator, denominator, raw value, score, band, coverage, missing reason, and formula version.
- Forecast model, assumptions, simulation seed/count, history window, calibration status, probability, P50/P80 dates, and censored outcomes.
- Overall score, score coverage, provisional status, data quality, delivery-risk flags, and explanation evidence.

Use null for unavailable values. Recommended reason codes: MISSING_ESTIMATES, MISSING_ACTUAL_HOURS, NO_REPRESENTATIVE_HISTORY, NOT_DUE, NO_COMMITTED_SCOPE, ZERO_THROUGHPUT, UNKNOWN_DEPENDENCIES, and UNBOUNDED_BLOCKER.

## 19. Edge cases and calculation acceptance checks

| Case | Required behavior |
|---|---|
| Junior does 10-base-hour item in 20 actual hours at m=2 | Efficiency 100% |
| Observed velocity 25 and R=300 | Duration 12 days; no further efficiency multiplier |
| New project 10% accepted and 10% planned | Feature health 100; progress 10% |
| No work due yet | Health section N/A, not division by zero |
| Zero throughput with work remaining | No finite observed forecast; show stall |
| No remaining work and all release gates passed | Complete; actual finish determines whether target was met |
| Target passed and required work remains | On-time probability 0; overdue |
| Closed task reopened and acceptance revoked | Remove acceptance credit; update remaining work once |
| Unverified Git change | Evidence candidate only, no accepted effort |
| Missing actual hours | Efficiency N/A |
| Sprint work accepted late | Original on-time result unchanged |
| Sequential tasks assigned to multiple people | Respect dependencies; do not divide total effort by all people blindly |
| Composite inputs 80,75,65,88,82,70 | Overall 76.9 |
| Incomplete simulation runs | Count misses and retain censoring; do not discard |

## 20. Implementation boundary

MVP: evidence ledger, milestone-based progress, configurable three-band scores, immutable sprint commitments, normalized efficiency where actual hours exist, one explicitly selected deterministic forecast model, working calendars, missing-data handling, and explanations grounded in source numbers.

Next stage: dependency-aware resource scheduling, empirical forecast distributions, calibration from historical snapshots, and configurable scope-change scenarios.

Until probability modeling is implemented and supported by data, display “On-time probability unavailable” alongside deterministic forecast and slack. AI may explain the result, but may not invent a confidence percentage to fill the dashboard.
