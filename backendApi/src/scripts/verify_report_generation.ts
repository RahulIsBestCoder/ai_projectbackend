import assert from 'node:assert/strict';
import { ReportingService } from '../domain/reporting/service/reporting_service';

async function main(): Promise<void> {
  const service: any = Object.create(ReportingService.prototype);
  let stored: any = null;
  let aiCalls = 0;
  service.initLog = () => {};
  service.log = () => {};
  service._reportModel = {
    findByAny: async () => stored,
    addNewRecord: async (value: any) => { stored = { _id: 'report-1', ...value }; return stored; },
    updateAnyRecord: async (_filter: any, value: any) => { stored = { ...stored, ...value }; },
  };
  service._ai = { generateReport: async (projectId: string, request: any) => {
    aiCalls++;
    return { summary: 'Delivery is on track.', insights: [], recommendations: [], confidence: 0.9,
      generated_by: 'ai', generated_at: new Date(), project_snapshot: { projectId }, report_request: request };
  } };
  (global as any).Helpers = {
    makeSuccessServiceStatus: (message: string, data: any) => ({ status: true, status_message: message, data_sets: data }),
    makeBadServiceStatus: (message: string) => ({ status: false, status_message: message }),
  };
  const input: any = { project_id: 'p1', name: 'Weekly', definition: { type: 'health_check' }, format: 'pdf' };
  const created = await service.createReport(input);
  assert.equal(created.status, true);
  assert.equal(aiCalls, 1);
  assert.ok(stored.generation_key);
  assert.equal(stored.report_data.summary, 'Delivery is on track.');
  assert.equal(stored.definition.generated_report.summary, stored.report_data.summary);
  assert.equal(stored.status, 'generated');
  assert.deepEqual(stored.scope, [...ReportingService.DEFAULT_SCOPE].sort());

  const cached = await service.createReport(input);
  assert.equal(cached.status_message, 'Stored report returned.');
  assert.equal(cached.data_sets.cache_hit, true);
  assert.equal(aiCalls, 1);

  await service.createReport({ ...input, content: 'Focus on risks.' });
  assert.equal(aiCalls, 2);
  assert.equal(stored.report_content, 'Focus on risks.');
  await service.createReport({ ...input, content: 'Focus on risks.', force_regenerate: true });
  assert.equal(aiCalls, 3);

  stored = null;
  const wholeProject = await service.createReport({ project_id: 'p2', name: 'Whole', scope: ['risks'], definition: { period: 'monthly' } });
  assert.equal(wholeProject.status, true);
  assert.equal(aiCalls, 4);
  assert.deepEqual(stored.scope, [...ReportingService.DEFAULT_SCOPE].sort());
  assert.equal(stored.definition.period, undefined);
  console.log('PASS: report JSON persists before rendering and identical requests use the DB cache.');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
