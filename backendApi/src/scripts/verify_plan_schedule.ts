import assert from 'node:assert/strict';
import { planningCalendar, schedulePlan, validatePlanInput, validPlanShape, projectPlanDeadline } from '../domain/ai_intelligence/service/plan_schedule';
import { AiIntelligenceService } from '../domain/ai_intelligence/service/ai_intelligence_service';
import { TaigaPublishService } from '../domain/integration/service/taiga_publish_service';
import { aiIntelligenceMiddleware } from '../domain/ai_intelligence/middleware/ai_intelligence_middleware';
import { IPlanGenerate, ISprintPlan } from '../domain/ai_intelligence/interface/ai_intelligence_interface';

const base: IPlanGenerate = { description: 'Test application', start_date: '2026-09-29', team_size: 4,
  features: Array.from({ length: 34 }, (_, i) => `Feature ${i + 1}`) };
const service: any = Object.create(AiIntelligenceService.prototype);
const makePlan = (count: number): ISprintPlan => ({ plan_name: 'Test', summary: 'AI draft', sprints: Array.from({ length: count }, (_, i) => ({
  name: `Sprint ${i + 1}`, tasks: [{ title: `Task ${i + 1}`, estimate_hours: 10, story_points: 5 }], deadline: '2099-01-01',
})), milestones: [{ name: 'Release', date: '2099-01-01' }], deadlines: [{ label: 'Wrong AI deadline', date: '2099-01-01' }] });

async function main() {
  const automatic = schedulePlan(service.buildDynamicFallbackPlan(base), base);
  assert.equal(automatic.sprints.length, 10);
  assert.equal(automatic.sprints[0].end_date, '2026-10-19');
  assert.equal(automatic.sprints[9].end_date, '2027-04-12');
  assert.equal(automatic.total_duration_weeks, 28);
  assert.equal(automatic.milestones!.at(-1)!.date, '2027-04-12');
  assert.equal(automatic.sprints.flatMap(s => s.tasks).length, 34);
  for (const sprint of automatic.sprints) assert.equal(sprint.planned_points, sprint.tasks.reduce((n, t) => n + (t.story_points || 0), 0));
  assert.match(service.buildPlanningPrompt(base), /Sprint Length: 3 weeks/);

  const short = { ...base, duration_weeks: 5, sprint_length_weeks: 2 };
  const partial = schedulePlan(makePlan(3), short);
  assert.equal(partial.sprints[2].end_date, '2026-11-02');
  assert.equal(partial.total_duration_weeks, 5);

  const tight = schedulePlan(makePlan(3), { ...base, deadline: '2026-10-10', sprint_length_weeks: 2 });
  assert.equal(tight.sprints.length, 1);
  assert.equal(tight.sprints[0].end_date, '2026-10-10');
  assert.equal(tight.sprints[0].tasks.length, 3);
  assert.ok(tight.deadlines!.every(d => d.date! <= '2026-10-10'));
  assert.ok(tight.milestones!.every(m => m.date! <= '2026-10-10'));
  assert.equal(tight.sprints[0].deadline, tight.sprints[0].end_date);
  const later = planningCalendar({ ...short, deadline: '2026-12-01' });
  assert.equal(new Date(later.end).toISOString().slice(0, 10), '2026-11-02');

  const weekend = schedulePlan(makePlan(1), { description: 'Weekend', start_date: '2026-10-03', deadline: '2026-10-03', team_size: 1 });
  assert.ok(weekend.risks!.some(r => r.description.includes('exceed 0 available hours')));
  const understaffed = makePlan(1);
  understaffed.sprints[0].tasks[0].assignee_role = 'backend';
  const staffing = schedulePlan(understaffed, { description: 'UI only', start_date: '2026-09-29', duration_weeks: 1, team_breakdown: { ui: 1 } });
  assert.ok(staffing.risks!.some(r => r.description.includes('backend needs 10 hours but has 0')));

  for (const invalid of [{ duration_weeks: -1 }, { sprint_length_weeks: 0 }, { sprint_length_weeks: 5 },
    { duration_weeks: 1.5 }, { deadline: '2026-09-28' }, { start_date: '2026-02-30' },
    { deadline: 'invalid' }, { team_breakdown: { ui: -1 } }, { features: [42] }]) {
    assert.throws(() => validatePlanInput({ ...base, ...invalid } as any));
  }
  assert.equal(validPlanShape({ sprints: [{}] }), false);
  assert.equal(service.parsePlanResponse(JSON.stringify({ sprints: [{}] })), null);
  let status = 0, nextCalled = false;
  const response: any = { status(n: number) { status = n; return this; }, json() {} };
  aiIntelligenceMiddleware.validateGeneratePlan({ body: { ...base, deadline: '2026-09-01' } } as any, response, () => { nextCalled = true; });
  assert.equal(status, 400);
  assert.equal(nextCalled, false);
  assert.equal(projectPlanDeadline({ input: { deadline: '2026-10-10' }, plan: makePlan(2) })!.toISOString().slice(0, 10), '2026-10-10');
  assert.equal(projectPlanDeadline({ plan: { sprints: [{ end_date: '2026-11-02' }], deadlines: [{ date: '2099-01-01' }] } })!.toISOString().slice(0, 10), '2026-11-02');

  // Many horizons, including leap day, partial final sprints, and every allowed sprint length.
  for (const start_date of ['2026-09-29', '2028-02-25']) for (let days = 1; days <= 80; days++) for (let weeks = 1; weeks <= 4; weeks++) {
    const deadline = new Date(Date.parse(start_date) + (days - 1) * 86400000).toISOString().slice(0, 10);
    const result = schedulePlan(makePlan(3), { description: 'Boundary', start_date, deadline, sprint_length_weeks: weeks });
    assert.equal(result.sprints[0].start_date, start_date);
    assert.equal(result.sprints.at(-1)!.end_date, deadline);
    assert.equal(result.sprints.flatMap(s => s.tasks).length, 3);
    result.sprints.forEach((s, i) => {
      assert.ok(s.start_date! <= s.end_date! && s.end_date! <= deadline);
      if (i) assert.equal(Date.parse(s.start_date!) - Date.parse(result.sprints[i - 1].end_date!), 86400000);
    });
  }
  // Exercise generation and persistence using mocked AI/storage, without external calls.
  service.initLog = () => {};
  service.log = () => {};
  let saved: any;
  service._planModel = { addNewRecord: async (row: any) => { saved = row; return { _id: 'test' }; } };
  service._generate = async () => JSON.stringify(makePlan(3));
  const payload = { description: 'App', start_date: '2026-09-29', deadline: '2026-10-10', team_breakdown: { backend: 2 } };
  await service.generatePlan(payload);
  assert.equal(saved.plan.sprints.at(-1).end_date, payload.deadline);
  service._generate = async () => { throw new Error('Mock provider outage'); };
  const fallback = await service.generatePlan(payload);
  assert.equal(fallback.generated_by, 'dynamic-fallback');
  assert.equal(fallback.plan.sprints.at(-1).end_date, payload.deadline);
  assert.ok(fallback.plan.risks.some((r: any) => r.description.includes('placeholders')));
  // Contract regression: repaired plans must publish through the existing entry
  // point without an adapter or any changes to Taiga's sprint/story/task hierarchy.
  (global as any).Helpers = {
    makeBadServiceStatus: (message: string) => ({ status: false, status_message: message }),
    makeSuccessServiceStatus: (message: string, data: any) => ({ status: true, status_message: message, data_sets: data }),
  };
  for (const plan of [automatic, partial, tight, fallback.plan]) {
    const publisher: any = Object.create(TaigaPublishService.prototype);
    const mappings: any[] = [], milestones: any[] = [], stories: any[] = [], publishedTasks: any[] = [];
    let nextId = 1;
    const matches = (row: any, query: any) => Object.entries(query).every(([key, value]) => row[key] === value);
    publisher._mappingModel = {
      findByAny: async (query: any) => mappings.find(row => matches(row, query)),
      findAllByAny: async (query: any) => mappings.filter(row => matches(row, query)),
      addNewRecord: async (data: any) => { mappings.push({ _id: nextId++, ...data }); },
    };
    publisher._planModel = {
      findByAny: async () => ({ project_id: 'project', status: 'accepted', plan }),
      updateAnyRecord: async (_query: any, update: any) => { assert.equal(update.publish_status, 'completed'); },
    };
    const roles = [...new Set(plan.sprints.flatMap((s: any) => s.tasks.map((t: any) => t.assignee_role)).filter(Boolean))];
    publisher._userMappingModel = { findAllByAny: async () => roles.map(role => ({ role, taiga_user_id: 123 })) };
    publisher.resolveIntegration = async () => ({ provider: 'taiga' });
    publisher.resolveTaigaProject = async () => ({ id: 42, slug: 'test' });
    publisher.buildClient = async () => ({
      hasSprints: async () => false,
      getMetadata: async () => ({ taskStatuses: [], userStoryStatuses: [], priorities: [] }),
      createMilestone: async (_id: number, body: any) => {
        const sprint = plan.sprints.find((s: any) => s.name === body.name)!;
        assert.equal(body.estimated_start, sprint.start_date);
        assert.equal(body.estimated_finish, sprint.end_date);
        assert.ok(body.estimated_start <= body.estimated_finish);
        const row = { id: nextId++, ...body }; milestones.push(row); return row;
      },
      createUserStory: async (_id: number, body: any) => {
        assert.ok(milestones.some(m => m.id === body.milestone));
        assert.equal(body.points, undefined); // Taiga requires role/point ids, not a numeric total.
        const row = { id: nextId++, ...body }; stories.push(row); return row;
      },
      createTask: async (_id: number, body: any) => {
        assert.ok(stories.some(s => s.id === body.user_story && s.milestone === body.milestone));
        assert.equal(body.points, undefined);
        const row = { id: nextId++, ...body }; publishedTasks.push(row); return row;
      },
    });
    const result = await publisher.createPlanInTaiga('plan', { allowUnassigned: false });
    assert.equal(result.status, true, result.status_message);
    assert.equal(result.data_sets.status, 'completed');
    assert.equal(milestones.length, plan.sprints.length);
    assert.equal(stories.length, plan.sprints.length);
    assert.equal(publishedTasks.length, plan.sprints.flatMap((s: any) => s.tasks).length);
    assert.deepEqual(publishedTasks.map(t => t.subject).sort(), plan.sprints.flatMap((s: any) => s.tasks.map((t: any) => t.title)).sort());
    assert.ok(mappings.some(m => m.external_id === 'sprint-1'));
    assert.ok(mappings.some(m => m.external_id === 'story_sprint-1'));
    assert.deepEqual(result.data_sets.errors, []);
  }
  console.log('PASS: automatic, shortened, tight-deadline and fallback plans publish via the unchanged Taiga entry point (mock Taiga/storage).');
  console.log('PASS: calendar consistency, 640 date boundary cases, capacity warnings, validation, authoritative deadlines, AI and fallback persistence.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
