# Plan Implementation — AI Sprint Plan Generator (`/v1/plans`)

> UI integration guide for the AI planning endpoint.
> Backend: TypeScript / Express / Mongoose (modular monolith) — base URL `http://localhost:3000`
> Status: **implemented & live-tested** (2026-09-10)

---

## 1. What this API does (the flow)

```
UI form (project description + planning inputs)
        │  POST /v1/plans
        ▼
Backend builds a strict "agile planner" prompt
        │
        ▼
Gemini (google_provider) generates the plan
        │                                   ┌─ provider OK ──► JSON parsed
        ▼                                   │
JSON parse + date normalization ◄───────────┤
        │                                   └─ provider fails ──► rule-based fallback plan
        ▼
Stored in Mongo (`ai_plans`) ──► response { id, generated_by, plan }
        │
        ▼
UI renders sprints / tasks / milestones / deadlines
```

The API **always** answers `200` with a usable plan — if the AI provider is
down or returns invalid JSON, a deterministic fallback plan is returned with
`generated_by: "heuristic-fallback"` (same convention as the existing
`/v1/ai/chat/summary` fallback).

---

## 2. Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/plans` | Generate an AI sprint/deadline plan from input |
| `GET`  | `/v1/plans?project_id=...` | List saved plans (optionally per project) |
| `GET`  | `/v1/plans/:id` | Fetch one saved plan |
| `POST` | `/v1/ai/plans` | Identical to `POST /v1/plans` (canonical mount) |

Notes:
- **CORS is open** (`origin: '*'`) — browser calls from any dev origin work.
- **No auth is required** on these routes today (see checklist §3, item 8).
- Every response uses the platform envelope (see §5).

---

## 3. ⚠️ INFO NEEDED FROM THE UI TEAM (checklist)

Please answer these so the integration can be finalized:

1. **Frontend stack** — React + TypeScript + Tailwind + TanStack Query (as in
   `frontend-integration-helper.md`)? Any component/state conventions to match?
2. **Where does the call live?** A standalone "AI Planner" page, or inside an
   existing project workspace (determines whether `project_id` is sent)?
3. **Form design** — which inputs are user-facing vs fixed defaults?
   (`description`, `project_name`, `team_size`, `duration_weeks`,
   `sprint_length_weeks`, `start_date`, `constraints[]`)
4. **Project linking** — should plans be tied to an existing project
   (`project_id`) so `GET /v1/plans?project_id=` filtering is used?
5. **"Apply plan" feature?** — push generated sprints/tasks into the real
   `/v1/sprints` and `/v1/work-items` collections (needs a new backend endpoint)?
6. **Regenerate / edit** — is a `PUT /v1/plans/:id` (edit) or regenerate button
   needed?
7. **Delete** — is `DELETE /v1/plans/:id` needed?
8. **Auth** — keep these routes open, or protect them with the same token flow
   as `/v1/user/*`?
9. **List shape** — `GET /v1/plans` currently returns *all* plans in insertion
   order (no pagination/sort). Do you need pagination, sorting, or filtering?
10. **Loading budget** — AI generation takes ~5–25 s typically (worst case
    ~90 s with provider retries). What loading UX do you want (spinner,
    progressive steps, background + poll)?
11. **Language** — AI output is English; any i18n requirement?
12. **Proxy** — will the UI hit `localhost:3000` directly or through a dev
    proxy? (Both work; CORS is open.)

---

## 4. `POST /v1/plans` — request

### Fields

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `description` | `string` | ✅ | — | What the project must deliver. The more detail, the better the plan. |
| `project_name` | `string` | — | derived from description | Used in `plan_name` / sprint goals. |
| `project_id` | `string` | — | `null` | Link the plan to an existing project (enables `GET /v1/plans?project_id=`). |
| `team_size` | `number` | — | `4` | AI sizes tasks for this team. |
| `duration_weeks` | `number` | — | `8` | Total plan duration. |
| `sprint_length_weeks` | `number` | — | `2` | Sprint count = `round(duration / sprint_length)`, min 1. |
| `start_date` | `string` | — | today | `YYYY-MM-DD`. Invalid values fall back to today. |
| `constraints` | `string[]` | — | `[]` | Extra rules passed to the AI ("must use React", "fixed go-live"...). |

### Example request

```http
POST /v1/plans
Content-Type: application/json

{
  "description": "Build a mobile-friendly e-commerce web app with product catalog, cart, checkout and admin dashboard",
  "project_name": "ShopSmart",
  "team_size": 5,
  "duration_weeks": 8,
  "sprint_length_weeks": 2,
  "start_date": "2026-09-10"
}
```

---

## 5. Response envelope

Every response is wrapped by the platform envelope:

```json
{
  "response": {
    "dataset": { ...payload... },
    "status": { "msg": "Ai sprint plan generated successfully", "action_status": true },
    "publish": { "version": "1.0.0", "developer": "aiproject" }
  }
}
```

- Success: `action_status: true`, payload in `dataset`.
- Service error: `action_status: false`, `dataset: {}`, `msg` explains why.
- Always check `response.status.action_status` (not just HTTP status).

### Success `dataset` (`POST /v1/plans`)

```json
{
  "id": "6aa2757141c3bc6465179609",
  "generated_by": "google",
  "model": "gemini-1.5-flash",
  "input": { "description": "...", "team_size": 5, "duration_weeks": 8 },
  "plan": { ...see §6... }
}
```

- `generated_by`: `"google"` → real AI plan; `"heuristic-fallback"` →
  deterministic plan because the provider was unavailable/invalid.
  **UI should show a small badge** so users know which one they got.
- `model`: Gemini model name, or `"rule-based"` for the fallback.

---

## 6. `plan` object — field reference

```json
{
  "plan_name": "Sprint Plan — ShopSmart",
  "summary": "1-3 sentence plan summary",
  "total_duration_weeks": 8,
  "sprints": [
    {
      "index": 1,
      "name": "Sprint 1",
      "goal": "Discovery, setup & architecture — ShopSmart",
      "start_date": "2026-09-10",
      "end_date": "2026-09-23",
      "deadline": "2026-09-23",
      "planned_points": 40,
      "tasks": [
        {
          "title": "Design data model & API contracts",
          "description": "…",
          "type": "story",
          "priority": "high",
          "assignee_role": "backend",
          "estimate_hours": 8,
          "story_points": 5
        }
      ]
    }
  ],
  "milestones": [ { "name": "Feature complete", "date": "2026-10-21", "description": "…" } ],
  "deadlines": [ { "label": "Sprint 2 deadline", "date": "2026-10-07" } ],
  "risks": [ { "description": "Scope creep", "severity": "medium", "mitigation": "…" } ],
  "assumptions": [ "Team of 5 available full-time." ],
  "generated_by": "heuristic-fallback"
}
```

### Rules the backend guarantees

| Rule | Detail |
|---|---|
| Sprint dates | Sprint *i* starts at `start_date + i × sprint_length_weeks`; ends the day before the next sprint starts. All `YYYY-MM-DD`. |
| `deadline` | Defaults to the sprint's `end_date` (AI may override). |
| Milestone dates | Spread evenly across the sprint timeline if the AI omitted them. |
| Deadlines | Auto-built from sprint end dates + milestone dates when the AI omits them. |
| Sprint count | Always matches `round(duration_weeks / sprint_length_weeks)`. |

Typical enum values (advisory, not enforced): `type` = `story | task | bug`,
`priority` = `low | medium | high | critical`, `assignee_role` =
`frontend | backend | fullstack | qa | devops | design`.

---

## 7. Errors & timing

### Error shapes (two — handle both)

1. **Validation error (plain JSON, not enveloped)** — e.g. `description` missing:

   ```json
   { "message": "description is required (describe the project to plan)." }
   ```

   HTTP `400`.

2. **Service error (enveloped)** — DB failure etc.:

   ```json
   {
     "response": {
       "dataset": {},
       "status": { "msg": "Something went wrong", "action_status": false },
       "publish": { "version": "1.0.0", "developer": "aiproject" }
     }
   }
   ```

### Timing

- Typical: **5–25 s** (one Gemini call).
- Worst case: **~90 s** (20 s timeout × 4 attempts + retry backoff) — only when
  the provider is misbehaving; then the fallback plan is returned and the
  request still ends `200`.
- **UI guidance:** client timeout ≥ `120 s`; show an indeterminate loader with
  step hints ("Analyzing requirements → Dividing sprints → Estimating
  deadlines") rather than a plain spinner.

---

## 8. `GET` endpoints

### `GET /v1/plans?project_id=...`

`dataset` = array of saved plan documents (insertion order, no pagination yet):

```json
{
  "response": {
    "dataset": [
      {
        "_id": "6aa2757141c3bc6465179609",
        "project_id": null,
        "title": "Sprint Plan — ShopSmart",
        "input": { "description": "...", "team_size": 5 },
        "plan": { "...same shape as §6..." },
        "provider": "google",
        "model": "gemini-1.5-flash",
        "created_at": "2026-09-10T09:16:33.248Z"
      }
    ],
    "status": { "msg": "Plans fetched successfully", "action_status": true },
    "publish": { "version": "1.0.0", "developer": "aiproject" }
  }
}
```

### `GET /v1/plans/:id`

`dataset` = single document (same shape). Unknown id → HTTP `400`,
`status.msg = "Plan not found."`.

---

## 9. Copy-paste TypeScript types for the UI

```ts
export interface GeneratePlanInput {
  description: string;
  project_name?: string;
  project_id?: string;
  team_size?: number;
  duration_weeks?: number;
  sprint_length_weeks?: number;
  start_date?: string;          // YYYY-MM-DD
  constraints?: string[];
}

export interface PlanTask {
  title: string;
  description?: string;
  type?: string;
  priority?: string;
  assignee_role?: string;
  estimate_hours?: number;
  story_points?: number;
}

export interface PlanSprint {
  index: number;
  name: string;
  goal?: string;
  start_date: string;           // YYYY-MM-DD
  end_date: string;
  deadline: string;
  planned_points?: number;
  tasks: PlanTask[];
}

export interface PlanMilestone { name: string; date?: string; description?: string; }
export interface PlanDeadline { label: string; date?: string; }
export interface PlanRisk { description: string; severity?: string; mitigation?: string; }

export interface SprintPlan {
  plan_name: string;
  summary: string;
  total_duration_weeks?: number;
  sprints: PlanSprint[];
  milestones?: PlanMilestone[];
  deadlines?: PlanDeadline[];
  risks?: PlanRisk[];
  assumptions?: string[];
  generated_by?: string;
}

export interface Envelope<T> {
  response: {
    dataset: T;
    status: { msg: string; action_status: boolean };
    publish: { version: string; developer: string };
  };
}

export interface GeneratedPlan {
  id: string;
  generated_by: 'google' | 'heuristic-fallback';
  model: string;
  input: GeneratePlanInput;
  plan: SprintPlan;
}
```

---

## 10. Integration code

### Plain fetch

```ts
const API = 'http://localhost:3000';

export async function generateSprintPlan(
  payload: GeneratePlanInput,
  signal?: AbortSignal,
): Promise<GeneratedPlan> {
  const res = await fetch(`${API}/v1/plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal, // wire to a Cancel button
  });
  const json = await res.json();
  if (!res.ok || !json?.response?.status?.action_status) {
    throw new Error(json?.response?.status?.msg || json?.message || 'Plan generation failed');
  }
  return json.response.dataset as GeneratedPlan;
}

export async function listPlans(projectId?: string) {
  const url = new URL(`${API}/v1/plans`);
  if (projectId) url.searchParams.set('project_id', projectId);
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || !json?.response?.status?.action_status) {
    throw new Error(json?.response?.status?.msg || json?.message || 'Failed to load plans');
  }
  return json.response.dataset;
}
```

### TanStack Query (mutation + loading UX)

```tsx
const mutation = useMutation({
  mutationFn: generateSprintPlan,
  onSuccess: (data) => {
    // data.plan.sprints / milestones / deadlines / risks ready to render
    // badge: data.generated_by === 'google' ? 'AI generated' : 'Fallback plan'
  },
});

// <button disabled={mutation.isPending}>
//   {mutation.isPending ? 'Generating plan…' : 'Generate plan'}
// </button>
```

---

## 11. UI rendering suggestions

| Data | Suggested widget |
|---|---|
| `plan.sprints` | Timeline / Gantt bars from `start_date`→`end_date`; sprint cards with task tables below |
| `plan.tasks` | Table grouped by sprint; columns: title, `assignee_role`, `priority` (color badge), `story_points`, `estimate_hours` |
| `plan.milestones` | Vertical markers on the timeline (name + `date`) |
| `plan.deadlines` | Sorted chronological list / calendar dots |
| `plan.risks` | Cards with `severity` color (high=red, medium=amber, low=slate) + `mitigation` |
| `plan.summary` / `assumptions` | Header summary block + expandable assumptions |
| `generated_by` | Badge: "AI generated" vs "Fallback plan" |

Recommended UI actions: **Regenerate** (re-POST same input), plans are
**auto-saved** server-side (just reload via `GET /v1/plans`), and
**Apply to project** (pending backend feature — checklist §3 item 5).

---

## 12. Not implemented yet (decide via checklist §3)

- `PUT /v1/plans/:id` — edit a plan
- `DELETE /v1/plans/:id` — delete a plan
- `GET /v1/plans` pagination / sorting
- `POST /v1/plans/:id/apply` — materialize the plan into real `sprints` + `work_items`
- Auth on plan routes
- Async job / webhook mode for very long generations

---

## 13. Quick test

```bash
# Generate
curl -X POST http://localhost:3000/v1/plans \
  -H "Content-Type: application/json" \
  -d '{"description":"Build a POS system for retail stores","project_name":"POS","team_size":4,"duration_weeks":6,"sprint_length_weeks":2}'

# List / fetch
curl http://localhost:3000/v1/plans
curl http://localhost:3000/v1/plans/<plan_id>

# Validation (expect 400 + {"message":"description is required..."})
curl -X POST http://localhost:3000/v1/plans -H "Content-Type: application/json" -d '{}'
```

Backend files (reference): `src/domain/ai_intelligence/models/ai_plan_model.ts`,
`.../service/ai_intelligence_service.ts`, `.../controller/ai_intelligence_controller.ts`,
`.../route/ai_intelligence_route.ts` (`/v1/ai/plans`), `src/app_routing.ts` (`/v1/plans` mount).




