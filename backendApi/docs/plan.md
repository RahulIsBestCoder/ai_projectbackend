# Health Section: "Run AI Health Assessment" Button — UI Integration Plan

## Goal

Add a button to the project **Health** section that asks the backend to score the project's
**Health** and **Quality** with AI. It also refreshes the risks, the deadline forecast and the project context.
Until it has run, the Health section shows `health: null`, `quality: null` and an overall status of
`unknown`, because only this action writes those scores.

## API contract

```http
POST /v1/projects/:projectId/ai-assessment/refresh
Authorization: Bearer <access_token>
Content-Type: application/json

{ "sync": false }
```

| Body field | Type | Default | Use |
| --- | --- | --- | --- |
| `sync` | boolean | `true` | `true` syncs GitHub and Taiga first. Send `false` when the project was synced recently (for example the AI Sync button ran), to avoid a second slow sync. |
| `provider` | string | server default | Optional AI provider override (`gemini`, `groq`, `deepseek`, `ollama`). Normally omit it. |
| `model` | string | server default | Optional model override. Normally omit it. |

- Requires a logged-in user who owns the project or is a member of it (otherwise 403).
- Unwrap the standard envelope and treat `response.status.action_status === false` as an error, even when the HTTP status is 200.
- It is a **long request**: an optional sync, two AI calls (assessment and AI risk analysis), a forecast and a context rebuild. Allow up to about 2 minutes and never retry automatically.

### What the backend runs, in order
1. Sync sources (only when `sync` is `true`). If the sync fails, it stops and nothing is saved.
2. AI health assessment: saves `health` and `quality` scores and sets `projects.health_score`.
3. AI risk analysis.
4. Deadline forecast (deterministic, no AI).
5. Rebuild the project context text.
6. Return the refreshed data.

If any step fails, the request returns `action_status: false` with a message, and the later steps don't run.

### Success response (`response.dataset`)
```ts
interface AiAssessmentRefreshResult {
  project_id: string;
  source_sync: unknown | null;            // null when sync: false
  assessment: {
    health: number | null;                // 0–100, null = not enough evidence
    quality: number | null;
    confidence_percent: number;
    summary: string;
    limitations: string[];
    evidence: string[];
    sources: string[];
    assessed_at: string;
  };
  health: ProjectHealth;                  // same shape as GET /v1/projects/:projectId/health
  completion_forecast: CompletionForecast;// same shape as GET /v1/projects/:projectId/predictions/completion
  risks: unknown;
  deadline_prediction: unknown;
  context_updated: true;
}
```
Use `dataset.health` and `dataset.completion_forecast` to update the Health section right away, with no extra GET.

## Placement

- In the **Health** section header, to the right of the title: **Run AI assessment**.
- Under the button, show "Last assessed 2h ago" from `assessment.assessed_at`. On a fresh page load, use the latest
  health dimension's data or leave it blank.
- When `overall.status === 'unknown'` and the health and quality values are `null`, show an empty-state
  call to action inside the section: "No AI health score yet. **Run AI assessment**".

## Button behaviour

1. Show the button only when a project is selected and the user has access.
2. On click:
   - Disable the button, set `aria-busy="true"`, and change the label to **Assessing project health…** with a spinner.
   - Keep the current health cards visible (dimmed) instead of showing a full-page loader.
3. Send `POST .../ai-assessment/refresh` with `{ sync: false }`.
   - Send `{ sync: true }` only if you offer a "Sync sources first" checkbox and the user ticks it.
4. On success:
   - Replace the Health section data with `dataset.health` (overall, dimensions, risk).
   - Replace the forecast widget with `dataset.completion_forecast`.
   - Show an assessment panel: summary, confidence %, limitations and evidence (collapsible).
   - Invalidate cached queries for health, the forecast, risks, predictions and the AI dashboard card for this project.
   - Show a toast: "AI health assessment updated".
5. On failure:
   - Keep the existing data and show the backend message (for example "Source sync failed; AI assessment was not saved.")
     with a **Retry** button.
6. Re-enable the button when the request finishes, whatever the result.

## Rendering rules

| Data | UI treatment |
| --- | --- |
| `health` / `quality` is a number | Score with its band: 80+ good (green), 60–79 fair (amber), under 60 at risk (red) |
| `health` / `quality` is `null` | "Not enough evidence" in grey, never `0` |
| `confidence_percent < 50` | Add a "Low confidence" badge next to the score |
| `limitations.length > 0` | Show them under the scores as a bullet list |
| Velocity / Progress still `null` / `0` after assessment | Hint: "Velocity and progress need completed Taiga sprints and done work items" (the AI doesn't set these) |

## State model

```ts
type HealthAssessmentState =
  | { phase: 'idle'; lastAssessedAt?: string }
  | { phase: 'assessing'; projectId: string; startedAt: string }
  | { phase: 'success'; projectId: string; assessedAt: string; confidence: number }
  | { phase: 'error'; projectId: string; message: string; retryable: boolean };
```

- Block a second request while `phase === 'assessing'`.
- If the user switches project during the request, apply the result only to the `projectId` the request started from.

## Client service sketch

```ts
refreshAiAssessment(projectId: string, options: { sync?: boolean } = {}) {
  return this.http.post<ApiEnvelope<AiAssessmentRefreshResult>>(
    `/v1/projects/${projectId}/ai-assessment/refresh`,
    { sync: options.sync ?? false },
  ).pipe(
    timeout(120_000),
    map(envelope => {
      if (!envelope.response.status.action_status) throw new Error(envelope.response.status.msg);
      return envelope.response.dataset;
    }),
  );
}
```

## Errors

| Response | UI |
| --- | --- |
| 401 | Existing token refresh or login flow |
| 403 `Project access required to sync.` / `Active user required.` | Hide or disable the button and show "You don't have access to assess this project" |
| `action_status: false` | Show the message, keep the current data, offer Retry |
| Timeout or network error | "Assessment is taking longer than expected. Refresh the Health section in a minute." Offer Retry, because the backend may still finish and save |

## Relationship to other buttons

- **AI Sync** pulls GitHub data only. It doesn't score health.
- **Run AI assessment** scores health and quality with AI; this is the only way these values get filled in.
- **Refresh report** regenerates the report the AI Dashboard reads. Run it after the assessment so dashboard cards show the new health score.

## Acceptance checks

- A project with no AI score shows the empty state with the button.
- Clicking runs one request. The button stays disabled until it finishes, and a second click does nothing.
- On success the Health section shows the new health and quality values (or "Not enough evidence") without reloading the page.
- On failure the previous data stays and Retry works.
- Switching projects during a request doesn't update the wrong project.
