import assert from 'node:assert/strict';
import { OrganizationService } from '../domain/organization/service/organization_service';
import { requireSyncAccess } from '../helper/sync_access_middleware';

const projectA = '6aae8b5324b246439e32fa69';
const projectB = '6aa3dcab151ea1909a177bd9';
const assignments: any[] = [];
let writes = 0;
const group = (project: string, name: string, reported: number, closed: number) => ({
  _id: { project_id: project, username: name, owner_id: name, full_name: name }, reported, closed,
  first_reported_at: new Date(), last_reported_at: new Date(),
});
const taskGroups = [group(projectA, 'Reporter', 10, 5), group(projectA, 'QA', 2, 2), group(projectB, 'Reporter', 4, 1)];
const issueGroups = [group(projectA, 'Reporter', 3, 1)];
const cursor = (rows: any[]) => ({ project: () => cursor(rows), toArray: async () => rows });
(global as any).logs = { writelog: () => {} };
(global as any).Helpers = {
  makeSuccessServiceStatus: (message: string, data: any) => ({ status: true, data_sets: data, status_message: message }),
  makeBadServiceStatus: (message: string) => ({ status: false, status_message: message }),
  unauthorizedStatusBuild: (res: any) => res.status(401).json({}),
};
(global as any).db = { connection: { db: { collection: (name: string) => ({
  find: (filter: any) => {
    if (name === 'projects') {
      const ids = filter._id?.$in?.map(String) || [projectA, projectB];
      return cursor(ids.map((id: string) => ({ _id: id, name: id })));
    }
    if (name === 'qa_reporter_roles') return cursor(assignments.filter(row => filter.project_id.$in.includes(row.project_id)));
    return cursor([]);
  },
  aggregate: (pipeline: any[]) => cursor((name === 'taiga_tasks' ? taskGroups : name === 'taiga_issues' ? issueGroups : [])
    .filter(row => pipeline[0].$match.project_id.$in.includes(row._id.project_id))),
  updateOne: async (filter: any, update: any, options: any) => {
    assert.equal(name, 'qa_reporter_roles');
    assert.equal(options.upsert, true);
    const index = assignments.findIndex(row => row._id === filter._id);
    const row = { ...filter, ...update.$set };
    if (index < 0) assignments.push(row); else assignments[index] = row;
    writes++;
  },
  // A user exists, but has no membership or ownership in the requested project.
  findOne: async () => name === 'users' ? { _id: 'viewer', is_active: true }
    : name === 'projects' ? { _id: projectA, owner_id: 'someone-else', is_deleted: false } : null,
}) } } };

async function main() {
  const service = Object.create(OrganizationService.prototype) as OrganizationService;
  const read = async (ids = [projectA]) => (await (service as any)._departments(undefined, ids)).departments.find((d: any) => d.id === 'testing');
  let dept = await read();
  assert.equal(dept.name, 'QA / Testing');
  assert.match(dept.description, /Included in QA efficiency/);
  assert.deepEqual(dept.tasks, { created: 12, closed: 7 }); // excludes three issues
  assert.deepEqual(dept.efficiency, { method: 'reported_item_closure_rate', reported: 15, closed: 8, percent: 53 });
  assert.equal((await service.setQaReporterRole(projectA, 'login:reporter', 'manager', 'editor')).status, true);
  dept = await read();
  assert.equal(dept.name, 'QA / Managers');
  assert.match(dept.description, /Only QA reporters count/);
  const manager = dept.employees.find((e: any) => e.id === 'login:reporter');
  assert.equal(manager.efficiency, null);
  assert.equal(manager.efficiency_eligible, false);
  assert.deepEqual(manager.tasks, { created: 10, closed: 5 }); // activity retained
  assert.equal(dept.efficiency.percent, 100); // QA's 2/2 only, managers removed from both sides
  assert.equal(dept.efficiency.reported, 2);
  assert.deepEqual(dept.tasks, { created: 12, closed: 7 });
  assert.equal((await read([projectB])).employees[0].reporting_role, 'qa');
  const combined = await read([projectA, projectB]);
  assert.equal(combined.efficiency.reported, 6); // excludes manager activity only in project A
  assert.equal(combined.efficiency.closed, 3);
  await service.setQaReporterRole(projectA, 'login:qa', 'manager', 'editor');
  assert.equal((await read()).name, 'Managers');
  assert.match((await read()).description, /Excluded from QA efficiency/);
  assert.equal((await read()).efficiency.percent, null); // all managers: not a zero score
  await service.setQaReporterRole(projectA, 'login:reporter', 'qa', 'editor');
  assert.equal((await read()).efficiency.percent, 46); // restored 6/13
  const previousWrites = writes;
  assert.equal((await service.setQaReporterRole(projectA, 'login:missing', 'manager', 'editor')).status, false);
  assert.equal((await service.setQaReporterRole(projectA, 'login:reporter', 'admin', 'editor')).status, false);
  assert.equal(writes, previousWrites);
  assert.equal(assignments.length, 2); // repeated save updates the same row
  let status = 0, nextCalled = false;
  const response: any = { status: (value: number) => { status = value; return response; }, json: () => {} };
  await requireSyncAccess({ body: {}, params: { projectId: projectA } } as any, response, () => { nextCalled = true; });
  assert.equal(status, 401);
  status = 0;
  await requireSyncAccess({ body: { loginDetails: { verifiedData: { user_id: 'viewer' } } }, params: { projectId: projectA } } as any,
    response, () => { nextCalled = true; });
  assert.equal(status, 0);
  assert.equal(nextCalled, true);
  console.log('PASS: QA/Manager persistence, project isolation, counts, exclusions, re-inclusion, invalid input and access checks');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
