import re

# Read the service file
with open(r"c:\Users\Dell\Downloads\backend-2026\src\domain\ai_intelligence\service\ai_intelligence_service.ts", "r", encoding="utf-8") as f:
    content = f.read()

print(f"Original file length: {len(content)}")

# New methods to add before buildPlanPrompt
new_methods = """
  /*
   * Layer 1: Generates a comprehensive plan with full context.
   * Includes features, team breakdown, rules, and constraints.
   */
  private buildPlanningPrompt(payload: IPlanGenerate): string {
    const teamBreakdown = payload.team_breakdown;
    const calculatedTeamSize = teamBreakdown
      ? (teamBreakdown.ui || 0) + (teamBreakdown.backend || 0) + (teamBreakdown.app || 0) + (teamBreakdown.others || 0)
      : 0;
    const teamSize = payload.team_size || calculatedTeamSize || 4;
    const features = payload.features || [];
    const featureCount = features.length || 10;
    const baseWeekPerFeature = 0.4;
    const optimalDuration = payload.duration_weeks || Math.max(4, Math.ceil((featureCount * baseWeekPerFeature * 8) / Math.max(1, teamSize)));
    const sprintWeeks = payload.sprint_length_weeks || (optimalDuration <= 6 ? 1 : optimalDuration <= 12 ? 2 : 3);
    const sprintCount = Math.max(1, Math.ceil(optimalDuration / sprintWeeks));

    const lines: string[] = [
      "You are an expert agile delivery planner. Create a detailed sprint execution plan.",
      "",
      "## PROJECT INFORMATION",
      `Project: ${payload.project_name || "Untitled Project"}`,
      `Description: ${payload.description.trim()}`,
      "",
      "## TEAM CONFIGURATION",
      `Total Team Size: ${teamSize} people`,
    ];

    if (teamBreakdown) {
      const depts: string[] = [];
      if (teamBreakdown.ui) depts.push(`UI: ${teamBreakdown.ui}`);
      if (teamBreakdown.backend) depts.push(`Backend: ${teamBreakdown.backend}`);
      if (teamBreakdown.app) depts.push(`App: ${teamBreakdown.app}`);
      if (teamBreakdown.others) depts.push(`Others: ${teamBreakdown.others}`);
      lines.push(`Team Breakdown: ${depts.join(", ")}`);
    }

    lines.push(
      `Duration: ${optimalDuration} weeks`,
      `Sprint Length: ${sprintWeeks} weeks`,
      `Number of Sprints: ${sprintCount}`,
    );

    if (payload.start_date) lines.push(`Start Date: ${payload.start_date}`);
    if (payload.deadline) lines.push(`Deadline: ${payload.deadline} (MUST complete by this date)`);
    if (payload.rules) lines.push("", "## RULES (MUST FOLLOW STRICTLY)", payload.rules);
    if (payload.constraints && payload.constraints.length > 0) {
      lines.push("", "## CONSTRAINTS (MANDATORY)");
      payload.constraints.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
    }
    if (features.length > 0) {
      lines.push("", "## FEATURES TO IMPLEMENT (ALL MUST BE INCLUDED IN PLAN)");
      features.forEach((f, i) => lines.push(`${i + 1}. ${f}`));
      lines.push("", `Total Features: ${features.length} - EVERY feature MUST be assigned to a sprint.`);
    }
    lines.push(
      "",
      "## PLANNING INSTRUCTIONS",
      `1. Divide ALL ${features.length || featureCount} features across exactly ${sprintCount} sprints.`,
      "2. Group related features together.",
      "3. Each sprint should have 3-8 tasks.",
      "4. Assign tasks to appropriate team departments.",
      "5. Create milestones and list risks.",
      "",
      "Respond with a detailed plan.",
    );
    return lines.join("\n");
  }

  /*
   * Layer 2: Converts the planning output into the required JSON structure.
   */
  private buildPurificationPrompt(planningOutput: string, payload: IPlanGenerate): string {
    const features = payload.features || [];
    const featureList = features.length > 0 ? features.join(", ") : "No specific features provided";
    const teamBreakdown = payload.team_breakdown;
    const teamSize = payload.team_size || (teamBreakdown
      ? (teamBreakdown.ui || 0) + (teamBreakdown.backend || 0) + (teamBreakdown.app || 0) + (teamBreakdown.others || 0)
      : 4);
    return `You are a JSON formatting expert. Convert the following plan into a valid JSON object.

## ORIGINAL PLAN OUTPUT
${planningOutput}

## PROJECT CONTEXT
- Features: ${featureList}
- Team Size: ${teamSize}
- Duration: ${payload.duration_weeks || "auto-calculated"} weeks
- Sprint Length: ${payload.sprint_length_weeks || "auto-calculated"} weeks
${payload.deadline ? `- Deadline: ${payload.deadline}` : ""}
${payload.rules ? `- Rules: ${payload.rules}` : ""}

## REQUIRED JSON STRUCTURE
Convert the plan above into this exact JSON structure:

{
  "plan_name": "string",
  "summary": "string",
  "sprints": [
    {
      "name": "Sprint 1",
      "goal": "sprint goal",
      "planned_points": 40,
      "tasks": [
        {
          "title": "string",
          "description": "string",
          "type": "story|task|bug",
          "priority": "low|medium|high|critical",
          "assignee_role": "frontend|backend|fullstack|qa|devops|design",
          "estimate_hours": 8,
          "story_points": 5
        }
      ]
    }
  ],
  "milestones": [{ "name": "string", "description": "string" }],
  "deadlines": [{ "label": "string", "date": "YYYY-MM-DD" }],
  "risks": [{ "description": "string", "severity": "low|medium|high", "mitigation": "string" }],
  "assumptions": ["string"]
}

## RULES
1. Include ALL features from the project context in the sprints
2. Each feature should be a task in the appropriate sprint
3. Assign tasks to appropriate departments (UI, Backend, App, Others)
4. Ensure the JSON is valid and complete
5. Respond with ONLY the JSON object (no markdown fences)

Respond with ONLY the JSON object.`;
  }

  /*
   * Dynamic fallback plan that uses features list, team breakdown, and rules.
   */
  private buildDynamicFallbackPlan(payload: IPlanGenerate): ISprintPlan {
    const DAY = 86400000;
    const features = payload.features || [];
    const teamBreakdown = payload.team_breakdown;
    const topic = String(payload.project_name || payload.description || "Project").trim().slice(0, 80);
    const calculatedTeamSize = teamBreakdown
      ? (teamBreakdown.ui || 0) + (teamBreakdown.backend || 0) + (teamBreakdown.app || 0) + (teamBreakdown.others || 0)
      : 0;
    const teamSize = payload.team_size || calculatedTeamSize || 4;
    const featureCount = features.length || 10;
    const baseWeekPerFeature = 0.4;
    let durationWeeks = payload.duration_weeks || Math.max(4, Math.ceil((featureCount * baseWeekPerFeature * 8) / Math.max(1, teamSize)));
    if (!payload.duration_weeks && payload.deadline && payload.start_date) {
      const startDate = new Date(payload.start_date);
      const endDate = new Date(payload.deadline);
      if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
        const diffMs = endDate.getTime() - startDate.getTime();
        durationWeeks = Math.max(1, Math.round(diffMs / (7 * DAY)));
      }
    }
    const sprintWeeks = payload.sprint_length_weeks || (durationWeeks <= 6 ? 1 : durationWeeks <= 12 ? 2 : 3);
    const sprintCount = Math.max(1, Math.ceil(durationWeeks / sprintWeeks));
    const deptRoles: Record<string, string[]> = {
      ui: ["frontend", "design", "fullstack"],
      backend: ["backend", "fullstack", "devops"],
      app: ["frontend", "fullstack", "qa"],
      others: ["qa", "devops", "fullstack"],
    };
    const priorityGroups: Record<string, string[]> = { "P0": [], "P1": [], "P2": [], "P3": [], "P4": [], "P5": [], "other": [] };
    features.forEach((feature) => {
      const priority = feature.match(/^P[0-5]/)?.[0] || "other";
      priorityGroups[priority] = priorityGroups[priority] || [];
      priorityGroups[priority].push(feature);
    });
    const orderedFeatures = [...priorityGroups["P0"], ...priorityGroups["P1"], ...priorityGroups["P2"], ...priorityGroups["P3"], ...priorityGroups["P4"], ...priorityGroups["P5"], ...priorityGroups["other"]];
    const sprints = Array.from({ length: sprintCount }, (_, i) => {
      const startIdx = Math.floor((i / sprintCount) * orderedFeatures.length);
      const endIdx = Math.floor(((i + 1) / sprintCount) * orderedFeatures.length);
      const sprintFeatures = orderedFeatures.slice(startIdx, endIdx);
      const tasks = sprintFeatures.map((feature, t) => {
        let assigneeRole = "fullstack";
        if (teamBreakdown) {
          const fl = feature.toLowerCase();
          if (fl.includes("ui") || fl.includes("design") || fl.includes("frontend") || fl.includes("banner") || fl.includes("cms") || fl.includes("seo")) {
            assigneeRole = teamBreakdown.ui ? deptRoles.ui[t % deptRoles.ui.length] : "fullstack";
          } else if (fl.includes("api") || fl.includes("backend") || fl.includes("database") || fl.includes("auth") || fl.includes("payment") || fl.includes("order")) {
            assigneeRole = teamBreakdown.backend ? deptRoles.backend[t % deptRoles.backend.length] : "fullstack";
          } else if (fl.includes("app") || fl.includes("mobile") || fl.includes("deep link") || fl.includes("push")) {
            assigneeRole = teamBreakdown.app ? deptRoles.app[t % deptRoles.app.length] : "fullstack";
          } else if (fl.includes("test") || fl.includes("qa") || fl.includes("report") || fl.includes("lead") || fl.includes("expense")) {
            assigneeRole = teamBreakdown.others ? deptRoles.others[t % deptRoles.others.length] : "qa";
          } else {
            const depts = ["ui", "backend", "app", "others"].filter(d => teamBreakdown[d as keyof ITeamBreakdown]);
            if (depts.length > 0) {
              const dept = depts[t % depts.length];
              assigneeRole = deptRoles[dept][t % deptRoles[dept].length];
            }
          }
        }
        return {
          title: feature.length > 80 ? feature.substring(0, 77) + "..." : feature,
          description: `Implement: ${feature}`,
          type: "task",
          priority: i === sprintCount - 1 ? "high" : i === 0 ? "high" : "medium",
          assignee_role: assigneeRole,
          estimate_hours: 8,
          story_points: 5,
        };
      });
      while (tasks.length < 3) {
        tasks.push({
          title: `Sprint ${i + 1} additional task ${tasks.length + 1}`,
          description: `Additional work for sprint ${i + 1}`,
          type: "task",
          priority: "medium",
          assignee_role: "fullstack",
          estimate_hours: 8,
          story_points: 3,
        });
      }
      return {
        index: i + 1,
        name: `Sprint ${i + 1}`,
        goal: `Implement ${sprintFeatures.length} features for ${topic}`,
        planned_points: teamSize * 8,
        tasks,
      };
    });
    const assumptions: string[] = [
      `Team of ${teamSize} available full-time.`,
      `${sprintWeeks}-week sprints.`,
    ];
    if (teamBreakdown) {
      const depts: string[] = [];
      if (teamBreakdown.ui) depts.push(`UI: ${teamBreakdown.ui}`);
      if (teamBreakdown.backend) depts.push(`Backend: ${teamBreakdown.backend}`);
      if (teamBreakdown.app) depts.push(`App: ${teamBreakdown.app}`);
      if (teamBreakdown.others) depts.push(`Others: ${teamBreakdown.others}`);
      assumptions.push(`Team breakdown by department: ${depts.join(", ")}.`);
    }
    if (payload.rules) assumptions.push(`Rules followed: ${payload.rules}`);
    if (payload.deadline) assumptions.push(`Project deadline: ${payload.deadline}.`);
    assumptions.push(`Total features to implement: ${features.length}.`);
    return {
      plan_name: `Sprint Plan - ${topic}`,
      summary: `Dynamic ${sprintCount}-sprint plan (${durationWeeks} weeks, ${sprintWeeks}-week sprints) covering ${features.length} features.`,
      total_duration_weeks: durationWeeks,
      sprints,
      milestones: [
        { name: "Foundation Complete", description: "Core architecture and setup done" },
        { name: "Feature Development", description: "Main features implemented" },
        { name: "Testing & QA", description: "Quality assurance complete" },
        ...(payload.deadline ? [{ name: "Project Deadline", description: "Final delivery", date: payload.deadline }] : []),
        { name: "Project Release", description: "Production deployment" },
      ],
      risks: [
        { description: "Scope creep across sprints", severity: "medium", mitigation: "Freeze sprint scope at planning." },
        { description: "Single points of failure in staffing", severity: "medium", mitigation: "Pair reviewers on critical modules." },
        { description: `Large feature count (${features.length}) may cause delays`, severity: "high", mitigation: "Prioritize and defer lower-priority items if needed." },
      ],
      assumptions,
      generated_by: "dynamic-fallback",
    };
  }

"""

# Add new methods before buildPlanPrompt
if "private buildPlanPrompt" in content:
    content = content.replace("private buildPlanPrompt", new_methods + "private buildPlanPrompt")
    print("Added 2-layer AI methods")
else:
    print("ERROR: Could not find buildPlanPrompt")

# Update generatePlan method
old_generate = """  public async generatePlan(payload: IPlanGenerate): Promise<{ id: any; generated_by: string; model: string; input: IPlanGenerate; plan: ISprintPlan }> {
    this.initLog();
    this.log('generatePlan', ['Request : ', payload]);

    const prompt = this.buildPlanPrompt(payload);
    let provider = 'google';
    let model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    let plan: ISprintPlan | null = null;

    try {
      const response = await this._generate(prompt, 'plan', payload.project_id);
      plan = this.parsePlanResponse(response);
      if (!plan) {
        this.log('generatePlan', 'AI response was not parseable plan JSON; using heuristic fallback.', 'WARN');
      }
    } catch (err: any) {
      // Provider unavailable/timeouts must never fail the request - same
      // convention as generateChatSummary's heuristic fallback.
      this.log('generatePlan', `provider unavailable (${err?.message || err}); using heuristic fallback.`, 'INFO');
    }

    if (!plan) {
      provider = 'heuristic-fallback';
      model = 'rule-based';
      plan = this.buildFallbackPlan(payload, 'AI provider unavailable or returned invalid JSON');
    }

    plan = this.normalizePlanDates(plan, payload);

    const record = await this._planModel.addNewRecord({
      project_id: payload.project_id || null,
      title: plan.plan_name,
      input: payload,
      plan,
      provider,
      model,
      prompt,
    });

    this.log('generatePlan', `Plan stored as ${record?._id}`);
    return { id: record?._id, generated_by: provider, model, input: payload, plan };
  }"""

new_generate = """  public async generatePlan(payload: IPlanGenerate): Promise<{ id: any; generated_by: string; model: string; input: IPlanGenerate; plan: ISprintPlan }> {
    this.initLog();
    this.log('generatePlan', ['Request : ', payload]);

    const planningPrompt = this.buildPlanningPrompt(payload);
    let provider = 'google';
    let model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    let plan: ISprintPlan | null = null;

    try {
      // Layer 1: Generate comprehensive plan with full context
      this.log('generatePlan', 'Layer 1: Generating comprehensive plan...');
      const planningOutput = await this._generate(planningPrompt, 'plan_layer1', payload.project_id);

      // Layer 2: Purify the output into required JSON structure
      this.log('generatePlan', 'Layer 2: Purifying output into JSON...');
      const purificationPrompt = this.buildPurificationPrompt(planningOutput, payload);
      const purifiedOutput = await this._generate(purificationPrompt, 'plan_layer2', payload.project_id);

      plan = this.parsePlanResponse(purifiedOutput);
      if (!plan) {
        this.log('generatePlan', 'Layer 2 failed; trying Layer 1 output directly.', 'WARN');
        plan = this.parsePlanResponse(planningOutput);
      }
      if (!plan) {
        this.log('generatePlan', 'Both AI layers failed; using dynamic fallback.', 'WARN');
      }
    } catch (err: any) {
      this.log('generatePlan', `AI error: ${err?.message || err}; using dynamic fallback.`, 'INFO');
    }

    if (!plan) {
      provider = 'dynamic-fallback';
      model = 'rule-based';
      plan = this.buildDynamicFallbackPlan(payload);
    }

    plan = this.normalizePlanDates(plan, payload);

    const record = await this._planModel.addNewRecord({
      project_id: payload.project_id || null,
      title: plan.plan_name,
      input: payload,
      plan,
      provider,
      model,
      prompt: planningPrompt,
    });

    this.log('generatePlan', `Plan stored as ${record?._id}`);
    return { id: record?._id, generated_by: provider, model, input: payload, plan };
  }"""

if old_generate in content:
    content = content.replace(old_generate, new_generate)
    print("Updated generatePlan method")
else:
    print("WARNING: Could not find exact generatePlan method to update")

# Write back
with open(r"c:\Users\Dell\Downloads\backend-2026\src\domain\ai_intelligence\service\ai_intelligence_service.ts", "w", encoding="utf-8") as f:
    f.write(content)

print(f"New file length: {len(content)}")
print("Done!")
