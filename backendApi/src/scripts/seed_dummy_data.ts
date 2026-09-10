import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

/**
 * Seed script: 3 months of realistic project data across all collections.
 * Run: npm run seed:dummy
 */

// ======================== CONFIGURATION ========================
const DAYS_BACK = 90;
const ORG_COUNT = 2;
const PROJECTS_PER_ORG = 3;
const TEAM_SIZE = 8;
const SPRINT_LENGTH_DAYS = 14;

// ======================== HELPERS ========================
const random = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomFloat = (min: number, max: number, decimals = 2) => Number((Math.random() * (max - min) + min).toFixed(decimals));
const randomPick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randomDate = (start: Date, end: Date) => new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
const randomBool = (probability = 0.5) => Math.random() < probability;

const now = new Date();
const threeMonthsAgo = new Date(now.getTime() - DAYS_BACK * 24 * 60 * 60 * 1000);

// ======================== NAME POOLS ========================
const FIRST_NAMES = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Quinn', 'Avery', 'Sage', 'River', 'Kai', 'Dakota', 'Skyler', 'Reese', 'Finley', 'Rowan', 'Emery', 'Blake', 'Drew', 'Hayden'];
const LAST_NAMES = ['Chen', 'Patel', 'Kim', 'Singh', 'Müller', 'Silva', 'Kumar', 'Zhang', 'Garcia', 'Johnson', 'Williams', 'Brown', 'Jones', 'Davis', 'Wilson', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris'];
const PROJECT_PREFIXES = ['Phoenix', 'Orion', 'Nova', 'Atlas', 'Quantum', 'Nexus', 'Pulse', 'Vertex', 'Horizon', 'Echo', 'Zenith', 'Apex'];
const PROJECT_SUFFIXES = ['Platform', 'Dashboard', 'API', 'Mobile', 'Web', 'Service', 'Engine', 'Hub', 'Cloud', 'Analytics'];
const WORK_ITEM_TITLES = [
  'Implement user authentication flow', 'Design database schema', 'Create REST API endpoints',
  'Add unit tests for core modules', 'Fix login page responsive layout', 'Optimize database queries',
  'Implement file upload feature', 'Add email notification system', 'Create admin dashboard',
  'Integrate third-party payment gateway', 'Implement search functionality', 'Add data export feature',
  'Fix memory leak in worker process', 'Implement caching layer', 'Add rate limiting to API',
  'Create onboarding wizard', 'Implement role-based access control', 'Add audit logging',
  'Optimize frontend bundle size', 'Implement WebSocket notifications', 'Add multi-language support',
  'Create CI/CD pipeline', 'Implement data validation layer', 'Add error tracking integration',
  'Implement pagination for list views', 'Add dark mode support', 'Create API documentation',
  'Implement soft delete functionality', 'Add bulk import feature', 'Implement data encryption'
];
const COMMIT_MESSAGES = [
  'feat: add user registration endpoint', 'fix: resolve null pointer in auth service',
  'refactor: extract common utilities', 'docs: update API documentation',
  'test: add integration tests for payments', 'style: format code with prettier',
  'fix: correct typo in error message', 'feat: implement file chunked upload',
  'refactor: optimize database query performance', 'fix: handle edge case in date parsing',
  'feat: add email verification flow', 'test: increase coverage for user module',
  'chore: update dependencies', 'fix: resolve race condition in sync service',
  'feat: implement real-time notifications', 'refactor: migrate to new API version',
  'fix: correct pagination offset bug', 'feat: add export to CSV functionality',
  'docs: add setup instructions', 'test: fix flaky integration test', 'feat: implement search filters',
  'fix: handle timeout in external API call', 'refactor: simplify authentication middleware',
  'feat: add user profile editing', 'chore: clean up unused imports', 'fix: resolve CORS issue',
  'feat: implement data caching', 'test: add unit tests for validators', 'style: improve code readability',
  'fix: correct validation error message', 'feat: add bulk operations support', 'refactor: extract service layer'
];
const RISK_FACTORS = [
  'Team velocity dropping below target', 'Key developer on leave', 'Third-party API deprecation',
  'Scope creep from stakeholder requests', 'Technical debt accumulation', 'Integration complexity underestimated',
  'Dependency on external team delivery', 'Infrastructure scaling concerns', 'Security audit findings',
  'Resource contention with parallel projects', 'Requirements ambiguity', 'Performance regression detected'
];
const RISK_SUMMARIES = [
  'Schedule risk due to declining sprint velocity. Recommend scope re-evaluation.',
  'Resource availability concern identified. Cross-training recommended to mitigate bus factor.',
  'Technical debt reaching critical threshold. Dedicated refactoring sprint advised.',
  'External dependency creating delivery bottleneck. Contingency plan needed.',
  'Quality metrics trending downward. Additional QA resources may be required.',
  'Scope stability at risk. Stakeholder alignment meeting recommended.'
];

// ======================== GENERATORS ========================
function generateAiResponse(type: string, projectName: string): string {
  const responses: Record<string, string[]> = {
    summary: [
      `${projectName} is progressing well with 78% of sprint goals completed on average. Team velocity has been stable at ~32 points per sprint. Key risks include resource availability in upcoming sprints and technical debt in the authentication module.`,
      `Project health score: 82/100. The team has maintained consistent delivery pace over the past month. Quality metrics show 94% test coverage. Recommend addressing 3 HIGH priority bugs before next release.`,
      `${projectName} shows positive momentum with velocity trending upward (+12% over last 3 sprints). Schedule adherence is strong at 91%. Main concern: code review turnaround time averaging 18 hours.`,
    ],
    analysis: [
      `Velocity analysis reveals a pattern of front-loaded sprints with 65% of points completed in the first week. This suggests either over-estimation or uneven work distribution. Recommend breaking down larger stories.`,
      `Bug density is highest in the payment module (0.8 bugs per story point vs 0.2 average). Root cause analysis points to insufficient integration testing. Recommend adding dedicated QA resources for payment features.`,
      `Team capacity utilization is at 87%, with 2 developers frequently overallocated. Cross-training initiative could reduce bottleneck risk. Sprint commitment accuracy has improved from 72% to 89% over the quarter.`,
    ],
    recommendation: [
      `1. Reduce WIP limit from 5 to 3 per developer to improve focus.\n2. Schedule dedicated refactoring sprint every 4th sprint.\n3. Implement automated regression testing for critical paths.\n4. Conduct knowledge sharing sessions for payment module.`,
      `Based on current trajectory, recommend:\n- Extending next sprint by 2 days to accommodate scope\n- Pair programming for complex authentication stories\n- Early stakeholder review for UI components\n- Technical debt reduction: allocate 20% capacity`,
    ],
    report: [
      `Quarterly Report for ${projectName}:\n\nKey Metrics:\n- Velocity: 32 pts/sprint (trending +8%)\n- Health Score: 82/100\n- Bug Escape Rate: 2.1%\n- On-time Delivery: 89%\n\nTop Risks:\n1. Key person dependency (mitigation: cross-training in progress)\n2. Third-party API reliability (mitigation: caching layer deployed)\n\nNext Quarter Focus:\n- Performance optimization\n- Security hardening\n- Developer experience improvements`,
    ],
  };
  return randomPick(responses[type] || responses.summary);
}

function generateNotificationBody(): string {
  const bodies = [
    'Sprint 3 has been completed with 34/40 story points delivered.',
    'Risk level for Project Phoenix changed from MEDIUM to HIGH.',
    'You have been assigned a new work item: "Implement OAuth flow".',
    'PR #42 has been merged to main branch.',
    'Build #128 failed on CI pipeline. Check logs for details.',
    'Deadline for Q2 milestone is approaching in 3 days.',
    'Your code review is requested on PR #56.',
    'New comment added to work item "Database optimization".',
    'Sprint retrospective meeting scheduled for Friday.',
    'Performance regression detected in API response times.',
  ];
  return randomPick(bodies);
}

// ======================== MAIN SEED FUNCTION ========================
async function run(): Promise<void> {
  const uri = `${process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/'}${process.env.DB_NAME || 'ai_project'}`;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB');

  // Clear existing data
  const collections = ['organizations', 'projects', 'users', 'integrations', 'git_intelligence',
    'work_items', 'sprints', 'commits', 'pull_requests', 'analytics_snapshots',
    'risk_predictions', 'ai_insights', 'notifications', 'reports',
    'project_members', 'milestones', 'dependencies', 'sync_history',
    'git_releases', 'ai_conversations'];
  for (const col of collections) {
    try { await mongoose.connection.collection(col).deleteMany({}); } catch { /* may not exist */ }
  }
  console.log('Cleared existing data');

  // ==================== 1. ORGANIZATIONS ====================
  console.log('\n--- Creating Organizations ---');
  const orgIds: string[] = [];
  for (let i = 0; i < ORG_COUNT; i++) {
    const orgName = `${randomPick(['Acme', 'TechCorp', 'InnovateLabs', 'DataDriven', 'CloudFirst', 'DevStudio'])} ${randomPick(['Inc', 'Solutions', 'Systems', 'Labs', 'Group'])}`.trim();
    const orgId = new mongoose.Types.ObjectId().toString();
    orgIds.push(orgId);
    await mongoose.connection.collection('organizations').insertOne({
      _id: new mongoose.Types.ObjectId(orgId),
      organization_id: i + 1,
      name: orgName,
      description: `${orgName} is a technology company focused on building innovative software solutions.`,
      github_org: `aiproject-org`,
      taiga_org: `aiproject`,
      settings: { timezone: 'UTC', working_days: ['mon', 'tue', 'wed', 'thu', 'fri'], sprint_length: 14 },
      created_at: randomDate(threeMonthsAgo, new Date(threeMonthsAgo.getTime() + 7 * 24 * 60 * 60 * 1000)),
      updated_at: new Date(),
      created_by: 1,
    });
    console.log(`  Created org: ${orgName}`);
  }

  // ==================== 2. TEAM MEMBERS ====================
  console.log('\n--- Creating Team Members ---');
  const userIds: string[] = [];
  const userEmails: string[] = [];
  for (let i = 0; i < TEAM_SIZE; i++) {
    const firstName = randomPick(FIRST_NAMES);
    const lastName = randomPick(LAST_NAMES);
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@aiproject.local`;
    const userId = new mongoose.Types.ObjectId().toString();
    userIds.push(userId);
    userEmails.push(email);
    await mongoose.connection.collection('users').insertOne({
      _id: new mongoose.Types.ObjectId(userId),
      user_id: i + 1,
      full_name: `${firstName} ${lastName}`,
      email,
      password_hash: await bcrypt.hash('Password@123', 10),
      is_active: true,
      role: randomPick(['ADMIN', 'TECH_LEAD', 'ENG_MANAGER', 'DEVELOPER', 'DEVELOPER', 'DEVELOPER']),
      organization_id: randomPick(orgIds),
      department_id: randomPick(['dept-eng', 'dept-product', 'dept-design', 'dept-qa']),
      team_id: randomPick(['team-frontend', 'team-backend', 'team-fullstack', 'team-devops']),
      avatar_url: `https://ui-avatars.com/api/?name=${firstName}+${lastName}&background=random`,
      joined_at: randomDate(threeMonthsAgo, new Date(threeMonthsAgo.getTime() + 30 * 24 * 60 * 60 * 1000)),
      created_at: randomDate(threeMonthsAgo, new Date(threeMonthsAgo.getTime() + 30 * 24 * 60 * 60 * 1000)),
      updated_at: new Date(),
    });
    console.log(`  Created user: ${firstName} ${lastName} (${email})`);
  }

  // ==================== 3. PROJECTS ====================
  console.log('\n--- Creating Projects ---');
  const projectData: Array<{ id: string; name: string; orgId: string; createdAt: Date }> = [];
  let projCounter = 0;
  for (const orgId of orgIds) {
    for (let j = 0; j < PROJECTS_PER_ORG; j++) {
      projCounter++;
      const projName = `${randomPick(PROJECT_PREFIXES)} ${randomPick(PROJECT_SUFFIXES)}`;
      const projId = new mongoose.Types.ObjectId().toString();
      const createdAt = randomDate(threeMonthsAgo, new Date(threeMonthsAgo.getTime() + 14 * 24 * 60 * 60 * 1000));
      projectData.push({ id: projId, name: projName, orgId, createdAt });
      await mongoose.connection.collection('projects').insertOne({
        _id: new mongoose.Types.ObjectId(projId),
        name: projName,
        description: `${projName} project. Built with React, Node.js, and MongoDB.`,
        organization_id: orgId,
        owner_id: randomPick(userIds),
        status: 1,
        health_score: random(60, 95),
        start_date: createdAt,
        end_date: new Date(createdAt.getTime() + random(90, 180) * 24 * 60 * 60 * 1000),
        target_date: new Date(createdAt.getTime() + random(60, 120) * 24 * 60 * 60 * 1000),
        is_deleted: false,
        created_at: createdAt,
        updated_at: new Date(),
      });
      console.log(`  Created project: ${projName}`);
    }
  }

  // ==================== 4. INTEGRATIONS ====================
  // Every integration (github / taiga / planner / ...) ALWAYS belongs to a
  // project — all synced artifacts inherit its project_id (plan §04/§05).
  console.log('\n--- Creating Integrations ---');
  const integrationIds: string[] = [];
  const integrationProjectMap: Array<{ id: string; projectId: string }> = [];
  for (const proj of projectData) {
    const ghId = new mongoose.Types.ObjectId().toString();
    integrationIds.push(ghId);
    integrationProjectMap.push({ id: ghId, projectId: proj.id });
    await mongoose.connection.collection('integrations').insertOne({
      _id: new mongoose.Types.ObjectId(ghId),
      provider: 'github',
      repository_name: `${proj.name.toLowerCase().replace(/\s+/g, '-')}-repo`,
      repository_organization: 'aiproject-org',
      repository_url: `https://github.com/aiproject-org/${proj.name.toLowerCase().replace(/\s+/g, '-')}`,
      token: `ghp_${uuidv4().replace(/-/g, '').substring(0, 36)}`,
      status: 1, project_id: proj.id, sync_status: 'completed', last_sync_at: new Date(),
      is_deleted: false, created_at: proj.createdAt, updated_at: new Date(),
    });
    const taigaId = new mongoose.Types.ObjectId().toString();
    integrationIds.push(taigaId);
    integrationProjectMap.push({ id: taigaId, projectId: proj.id });
    await mongoose.connection.collection('integrations').insertOne({
      _id: new mongoose.Types.ObjectId(taigaId),
      provider: 'taiga',
      repository_name: proj.name.toLowerCase().replace(/\s+/g, '-'),
      repository_organization: 'aiproject',
      repository_url: `https://tree.taiga.io/project/${proj.name.toLowerCase().replace(/\s+/g, '-')}`,
      token: uuidv4(),
      status: 1, project_id: proj.id, sync_status: 'completed', last_sync_at: new Date(),
      is_deleted: false, created_at: proj.createdAt, updated_at: new Date(),
    });
    const plannerId = new mongoose.Types.ObjectId().toString();
    integrationIds.push(plannerId);
    integrationProjectMap.push({ id: plannerId, projectId: proj.id });
    await mongoose.connection.collection('integrations').insertOne({
      _id: new mongoose.Types.ObjectId(plannerId),
      provider: 'planner',
      repository_name: `${proj.name.toLowerCase().replace(/\s+/g, '-')}-plan`,
      repository_organization: 'aiproject-plans',
      repository_url: `https://tasks.office.com/aiproject/plans/${proj.name.toLowerCase().replace(/\s+/g, '-')}`,
      token: uuidv4(),
      status: 1, project_id: proj.id, sync_status: 'completed', last_sync_at: new Date(),
      is_deleted: false, created_at: proj.createdAt, updated_at: new Date(),
    });
    console.log(`  Created integrations (github, taiga, planner) for: ${proj.name}`);
  }

  // ==================== 5. GIT REPOSITORIES ====================
  console.log('\n--- Creating Git Repositories ---');
  const repoIds: string[] = [];
  const repoProjectMap: Record<string, string> = {};
  for (const proj of projectData) {
    const repoId = new mongoose.Types.ObjectId().toString();
    repoIds.push(repoId);
    repoProjectMap[repoId] = proj.id;
    await mongoose.connection.collection('git_intelligence').insertOne({
      _id: new mongoose.Types.ObjectId(repoId),
      repository_id: `repo_${uuidv4().substring(0, 8)}`,
      provider: 'github', project_id: proj.id,
      token: `ghp_${uuidv4().replace(/-/g, '').substring(0, 36)}`,
      status: 1, is_deleted: false, created_at: proj.createdAt, updated_at: new Date(),
    });
    console.log(`  Created repo for: ${proj.name}`);
  }

  // ==================== 6. SPRINTS ====================
  console.log('\n--- Creating Sprints ---');
  const sprintData: Array<{ id: string; projectId: string; startDate: Date; endDate: Date; plannedPoints: number }> = [];
  for (const proj of projectData) {
    for (let s = 0; s < 6; s++) {
      const sprintStart = new Date(proj.createdAt.getTime() + s * SPRINT_LENGTH_DAYS * 24 * 60 * 60 * 1000);
      const sprintEnd = new Date(sprintStart.getTime() + (SPRINT_LENGTH_DAYS - 1) * 24 * 60 * 60 * 1000);
      const plannedPoints = random(20, 45);
      const sprintId = new mongoose.Types.ObjectId().toString();
      const status = sprintEnd < now ? 'completed' : (sprintStart < now ? 'active' : 'planned');
      const completedPoints = status === 'completed' ? Math.round(plannedPoints * randomFloat(0.7, 1.0)) : 0;
      sprintData.push({ id: sprintId, projectId: proj.id, startDate: sprintStart, endDate: sprintEnd, plannedPoints });
      await mongoose.connection.collection('sprints').insertOne({
        _id: new mongoose.Types.ObjectId(sprintId),
        project_id: proj.id, name: `Sprint ${s + 1}`,
        goal: `Deliver ${plannedPoints} story points focusing on core features`,
        start_date: sprintStart, end_date: sprintEnd, status,
        planned_points: plannedPoints, completed_points: completedPoints,
        retrospective: status === 'completed' ? {
          went_well: Array.from({ length: random(2, 4) }, () => randomPick(['Good team collaboration', 'Clear requirements', 'Effective code reviews', 'On-time deliveries', 'Quick bug fixes'])),
          improve: Array.from({ length: random(1, 3) }, () => randomPick(['Better estimation', 'More testing', 'Fewer meetings', 'Clearer docs', 'Reduce scope creep'])),
          action_items: Array.from({ length: random(1, 2) }, () => randomPick(['Adopt pair programming', 'Increase test coverage', 'RefineDefinition of Done', 'Add tech debt sprint'])),
        } : null,
        is_deleted: false, created_at: sprintStart, updated_at: new Date(),
      });
    }
    console.log(`  Created 6 sprints for: ${proj.name}`);
  }

  // ==================== 7. WORK ITEMS ====================
  console.log('\n--- Creating Work Items ---');
  const workItemData: Array<{ id: string; projectId: string; sprintId: string; storyPoints: number; status: string; createdAt: Date; completedAt?: Date }> = [];
  for (const proj of projectData) {
    const projSprints = sprintData.filter(s => s.projectId === proj.id);
    const numWorkItems = random(35, 55);
    for (let w = 0; w < numWorkItems; w++) {
      const sprint = randomPick(projSprints);
      const storyPoints = randomPick([1, 2, 3, 5, 8, 13]);
      const status = randomPick(['todo', 'in_progress', 'in_progress', 'in_review', 'done', 'done', 'done']);
      const createdAt = randomDate(sprint.startDate, new Date(Math.min(sprint.endDate.getTime(), now.getTime())));
      const completedAt = status === 'done' ? randomDate(createdAt, new Date(Math.min(sprint.endDate.getTime(), now.getTime()))) : undefined;
      const workItemId = new mongoose.Types.ObjectId().toString();
      workItemData.push({ id: workItemId, projectId: proj.id, sprintId: sprint.id, storyPoints, status, createdAt, completedAt });
      await mongoose.connection.collection('work_items').insertOne({
        _id: new mongoose.Types.ObjectId(workItemId),
        project_id: proj.id, integration_id: randomPick(integrationIds),
        external_id: `EXT-${random(1000, 9999)}`,
        title: randomPick(WORK_ITEM_TITLES),
        description: `Detailed implementation notes for this work item. Includes acceptance criteria.`,
        type: randomPick(['story', 'story', 'story', 'task', 'task', 'bug', 'epic']),
        status, priority: randomPick(['low', 'medium', 'medium', 'high', 'high', 'critical']),
        assignee_id: randomPick(userIds), sprint_id: sprint.id, story_points: storyPoints,
        time_estimate: random(1, 40), time_spent: random(0, 35),
        labels: Array.from({ length: random(1, 3) }, () => randomPick(['frontend', 'backend', 'api', 'ui', 'database', 'testing', 'devops', 'security', 'performance'])),
        milestone_id: `ms-${random(1, 5)}`,
        is_deleted: false, created_at: createdAt, updated_at: completedAt || createdAt,
      });
    }
    console.log(`  Created ${numWorkItems} work items for: ${proj.name}`);
  }

  // ==================== 7b. RECONCILE SPRINT completed_points ====================
  // Sprint.completed_points must equal the SUM of done work-item points in
  // that sprint, otherwise summaries/burndowns disagree with the raw data.
  console.log('\n--- Reconciling sprint completed_points from work items ---');
  for (const sprint of sprintData) {
    const agg = await mongoose.connection.collection('work_items').aggregate([
      { $match: { sprint_id: sprint.id, status: 'done', is_deleted: false } },
      { $group: { _id: null, points: { $sum: '$story_points' } } },
    ]).toArray();
    const donePoints = agg.length ? agg[0].points : 0;
    await mongoose.connection.collection('sprints').updateOne(
      { _id: new mongoose.Types.ObjectId(sprint.id) },
      { $set: { completed_points: donePoints } }
    );
  }
  console.log(`  Reconciled ${sprintData.length} sprints`);

  // ==================== 8. COMMITS ========================
  console.log('\n--- Creating Commits ---');
  let totalCommits = 0;
  for (const proj of projectData) {
    const numCommits = random(80, 150);
    const commits: any[] = [];
    for (let c = 0; c < numCommits; c++) {
      const author = randomPick(userEmails);
      const commitDate = randomDate(threeMonthsAgo, now);
      commits.push({
        project_id: proj.id, repository_id: randomPick(repoIds),
        sha: uuidv4().replace(/-/g, '').substring(0, 40),
        message: randomPick(COMMIT_MESSAGES),
        author_name: author.split('@')[0], author_email: author,
        // `committed_at` per DB dictionary (AI_Project_DB_Dictionary_Mongo.md §commits)
        committed_at: commitDate, additions: random(1, 200), deletions: random(0, 100),
        lines_changed: random(1, 300), files_changed: random(1, 15),
        is_deleted: false, created_at: commitDate,
      });
    }
    await mongoose.connection.collection('commits').insertMany(commits);
    totalCommits += numCommits;
    console.log(`  Created ${numCommits} commits for: ${proj.name}`);
  }

  // ==================== 9. PULL REQUESTS ====================
  console.log('\n--- Creating Pull Requests ---');
  let totalPRs = 0;
  for (const proj of projectData) {
    const numPRs = random(15, 35);
    const prs: any[] = [];
    for (let p = 0; p < numPRs; p++) {
      const createdAt = randomDate(threeMonthsAgo, now);
      const status = randomPick(['open', 'merged', 'merged', 'merged', 'closed']);
      const mergedAt = status === 'merged' ? randomDate(createdAt, new Date(Math.min(createdAt.getTime() + 3 * 24 * 60 * 60 * 1000, now.getTime()))) : undefined;
      const reviews = Array.from({ length: random(1, 3) }, () => ({
        reviewer: randomPick(userEmails),
        state: randomPick(['approved', 'approved', 'approved', 'changes_requested', 'commented']),
        submitted_at: randomDate(createdAt, new Date(Math.min(createdAt.getTime() + 2 * 24 * 60 * 60 * 1000, now.getTime()))),
      }));
      prs.push({
        project_id: proj.id, repository_id: randomPick(repoIds),
        number: p + 1, title: randomPick(COMMIT_MESSAGES),
        description: 'PR description with implementation details and testing notes.',
        status, author: randomPick(userEmails),
        branch: randomPick(['feature/auth', 'feature/dashboard', 'fix/login-bug', 'feature/api', 'refactor/core', 'feature/ui']),
        target_branch: 'main', created_at: createdAt, merged_at: mergedAt,
        closed_at: status === 'closed' ? randomDate(createdAt, now) : undefined,
        additions: random(10, 500), deletions: random(0, 200), files_changed: random(1, 20),
        reviews, is_deleted: false,
      });
    }
    await mongoose.connection.collection('pull_requests').insertMany(prs);
    totalPRs += numPRs;
    console.log(`  Created ${numPRs} PRs for: ${proj.name}`);
  }

  // ==================== 10. ANALYTICS SNAPSHOTS ====================
  console.log('\n--- Creating Analytics Snapshots ---');
  let totalSnapshots = 0;
  for (const proj of projectData) {
    const projWorkItems = workItemData.filter(w => w.projectId === proj.id);
    for (let d = 0; d < DAYS_BACK; d++) {
      const snapshotDate = new Date(threeMonthsAgo.getTime() + d * 24 * 60 * 60 * 1000);
      if (snapshotDate > now) break;
      const itemsUpToNow = projWorkItems.filter(w => w.createdAt <= snapshotDate);
      const doneItems = itemsUpToNow.filter(w => w.status === 'done');
      const totalPoints = itemsUpToNow.reduce((sum, w) => sum + w.storyPoints, 0);
      const completedPoints = doneItems.reduce((sum, w) => sum + w.storyPoints, 0);
      const progress = totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0;
      const velocity = completedPoints / Math.max(1, d / 7);
      const quality = randomFloat(70, 98);
      const schedule = randomFloat(60, 95);
      const risk = randomFloat(40, 90);
      const delivery = randomFloat(65, 100);
      const healthScore = Math.min(100, Math.max(0, Math.round(schedule * 0.2 + progress * 0.2 + velocity * 5 + quality * 0.15 + (100 - risk) * 0.15 + delivery * 0.1)));
      const snapshots = [
        { project_id: proj.id, metric_type: 'health', value: healthScore, breakdown: { schedule, progress: Math.round(progress), velocity: Math.round(velocity * 100) / 100, quality, risk, delivery }, period: 'daily', calculation_version: 'v1', captured_at: snapshotDate, is_deleted: false, created_at: snapshotDate },
        { project_id: proj.id, metric_type: 'velocity', value: Math.round(velocity * 100) / 100, breakdown: { completed_points: completedPoints, total_points: totalPoints, weeks: Math.round(d / 7 * 10) / 10 }, period: 'daily', calculation_version: 'v1', captured_at: snapshotDate, is_deleted: false, created_at: snapshotDate },
        { project_id: proj.id, metric_type: 'progress', value: Math.round(progress * 100) / 100, breakdown: { done_items: doneItems.length, total_items: itemsUpToNow.length, completed_points: completedPoints, total_points: totalPoints }, period: 'daily', calculation_version: 'v1', captured_at: snapshotDate, is_deleted: false, created_at: snapshotDate },
        { project_id: proj.id, metric_type: 'quality', value: quality, breakdown: { bug_count: random(0, 5), test_coverage: randomFloat(70, 95), code_review_pass_rate: randomFloat(85, 100) }, period: 'daily', calculation_version: 'v1', captured_at: snapshotDate, is_deleted: false, created_at: snapshotDate },
      ];
      await mongoose.connection.collection('analytics_snapshots').insertMany(snapshots);
      totalSnapshots += snapshots.length;
    }
    console.log(`  Created daily analytics for: ${proj.name}`);
  }

  // ==================== 11. RISK PREDICTIONS ====================
  console.log('\n--- Creating Risk Predictions ---');
  let totalRisks = 0;
  for (const proj of projectData) {
    const numWeeks = Math.floor(DAYS_BACK / 7);
    for (let w = 0; w < numWeeks; w++) {
      const weekDate = new Date(threeMonthsAgo.getTime() + w * 7 * 24 * 60 * 60 * 1000);
      if (weekDate > now) break;
      const riskLevel = randomPick(['LOW', 'LOW', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'HIGH']);
      const confidence = randomFloat(0.55, 0.95);
      const targetDate = new Date(weekDate.getTime() + random(7, 30) * 24 * 60 * 60 * 1000);
      const predictions = [
        { project_id: proj.id, kind: 'risk', risk_level: riskLevel, predicted_date: weekDate, target_date: targetDate, confidence_score: confidence, factors: Array.from({ length: random(2, 4) }, () => randomPick(RISK_FACTORS)), summary: randomPick(RISK_SUMMARIES), is_deleted: false, created_at: weekDate },
        { project_id: proj.id, kind: 'prediction', risk_level: riskLevel, predicted_date: weekDate, target_date: targetDate, confidence_score: confidence, factors: [`Velocity trend: ${randomFloat(-15, 25)}%`, `Team capacity: ${random(70, 100)}%`], summary: `Predicted completion: ${randomFloat(60, 100)}% of sprint goals by target date.`, is_deleted: false, created_at: weekDate },
      ];
      await mongoose.connection.collection('risk_predictions').insertMany(predictions);
      totalRisks += predictions.length;
    }
    console.log(`  Created weekly risk predictions for: ${proj.name}`);
  }

  // ==================== 12. AI INSIGHTS ====================
  console.log('\n--- Creating AI Insights ---');
  let totalInsights = 0;
  for (const proj of projectData) {
    const numInsights = random(5, 12);
    for (let i = 0; i < numInsights; i++) {
      const insightDate = randomDate(threeMonthsAgo, now);
      const insightType = randomPick(['summary', 'analysis', 'recommendation', 'report']);
      await mongoose.connection.collection('ai_insights').insertOne({
        project_id: proj.id, type: insightType, provider: 'gemini', model: 'gemini-1.5-flash',
        prompt: `Generate ${insightType} for project ${proj.name}`,
        response: generateAiResponse(insightType, proj.name),
        context_meta: { generated_at: insightDate, data_points: random(10, 100) },
        cached: true, is_deleted: false, created_at: insightDate, updated_at: insightDate,
      });
      totalInsights++;
    }
    console.log(`  Created ${numInsights} AI insights for: ${proj.name}`);
  }

  // ==================== 13. NOTIFICATIONS ====================
  console.log('\n--- Creating Notifications ---');
  let totalNotifications = 0;
  for (const userId of userIds) {
    const numNotifs = random(5, 15);
    const notifs: any[] = [];
    for (let n = 0; n < numNotifs; n++) {
      const notifDate = randomDate(threeMonthsAgo, now);
      const isRead = randomBool(0.6);
      notifs.push({
        user_id: userId,
        // project-scoped notification: tie it to a random project
        project_id: randomPick(projectData).id,
        title: randomPick(['Sprint completed', 'Risk level changed', 'New work item assigned', 'PR merged', 'Build failed', 'Deadline approaching', 'Code review requested']),
        body: generateNotificationBody(),
        type: randomPick(['info', 'warning', 'success', 'error']),
        channel: randomPick(['in_app', 'in_app', 'in_app', 'email']),
        is_read: isRead, read_at: isRead ? randomDate(notifDate, now) : undefined,
        is_deleted: false, created_at: notifDate,
      });
    }
    await mongoose.connection.collection('notifications').insertMany(notifs);
    totalNotifications += numNotifs;
  }
  console.log(`  Created ${totalNotifications} notifications total`);

  // ==================== 14. REPORTS ====================
  console.log('\n--- Creating Reports ---');
  let totalReports = 0;
  for (const proj of projectData) {
    const numReports = random(2, 5);
    for (let r = 0; r < numReports; r++) {
      const reportDate = randomDate(threeMonthsAgo, now);
      await mongoose.connection.collection('reports').insertOne({
        project_id: proj.id,
        name: `${randomPick(['Weekly', 'Monthly', 'Sprint', 'Quarterly'])} Report - ${proj.name}`,
        definition: { type: randomPick(['sprint_review', 'health_check', 'risk_assessment', 'progress_report']), period: randomPick(['weekly', 'monthly', 'sprint']) },
        format: randomPick(['pdf', 'pdf', 'html']),
        status: randomPick(['completed', 'completed', 'pending', 'failed']),
        artifact_url: randomBool(0.7) ? `https://storage.example.com/reports/${uuidv4()}.pdf` : undefined,
        is_deleted: false, created_at: reportDate, updated_at: reportDate,
      });
      totalReports++;
    }
    console.log(`  Created ${numReports} reports for: ${proj.name}`);
  }

  // ==================== 15. PROJECT MEMBERS ====================
  console.log('\n--- Creating Project Members ---');
  let totalMembers = 0;
  for (const proj of projectData) {
    const numMembers = random(4, 7);
    const members: any[] = [];
    const usedUsers = new Set<string>();
    for (let m = 0; m < numMembers; m++) {
      let userId = randomPick(userIds);
      while (usedUsers.has(userId)) userId = randomPick(userIds);
      usedUsers.add(userId);
      members.push({
        project_id: proj.id, user_id: userId,
        project_role: randomPick(['TECH_LEAD', 'DEVELOPER', 'DEVELOPER', 'DEVELOPER', 'QA_ENGINEER', 'PRODUCT_MANAGER']),
        allocation_percentage: randomPick([25, 50, 75, 100, 100]),
        is_active: randomBool(0.9),
        joined_at: randomDate(proj.createdAt, new Date()),
        is_deleted: false, created_at: proj.createdAt,
      });
    }
    await mongoose.connection.collection('project_members').insertMany(members);
    totalMembers += numMembers;
  }
  console.log(`  Created ${totalMembers} project member records`);

  // ==================== 16. MILESTONES ====================
  console.log('\n--- Creating Milestones ---');
  let totalMilestones = 0;
  for (const proj of projectData) {
    const numMilestones = random(3, 6);
    const milestones: any[] = [];
    for (let m = 0; m < numMilestones; m++) {
      const msDate = new Date(proj.createdAt.getTime() + (m + 1) * random(14, 30) * 24 * 60 * 60 * 1000);
      milestones.push({
        project_id: proj.id, name: `Milestone ${m + 1}: ${randomPick(['Alpha', 'Beta', 'RC', 'GA', 'v1.0', 'v2.0', 'MVP', 'Launch'])}`,
        description: `Deliverable milestone for ${proj.name}`,
        due_date: msDate, completed: msDate < now,
        progress: msDate < now ? randomFloat(70, 100) : randomFloat(0, 60),
        is_deleted: false, created_at: proj.createdAt, updated_at: new Date(),
      });
    }
    await mongoose.connection.collection('milestones').insertMany(milestones);
    totalMilestones += numMilestones;
  }
  console.log(`  Created ${totalMilestones} milestones`);

  // ==================== 17. DEPENDENCIES ====================
  console.log('\n--- Creating Dependencies ---');
  let totalDeps = 0;
  for (const proj of projectData) {
    const numDeps = random(1, 4);
    const deps: any[] = [];
    const otherProjects = projectData.filter(p => p.id !== proj.id);
    for (let d = 0; d < numDeps; d++) {
      if (otherProjects.length === 0) break;
      deps.push({
        project_id: proj.id, depends_on_project_id: randomPick(otherProjects).id,
        type: randomPick(['blocks', 'requires', 'relates_to']),
        is_deleted: false, created_at: proj.createdAt,
      });
    }
    await mongoose.connection.collection('dependencies').insertMany(deps);
    totalDeps += deps.length;
  }
  console.log(`  Created ${totalDeps} dependencies`);

  // ==================== 18. SYNC HISTORY ====================
  console.log('\n--- Creating Sync History ---');
  let totalSyncs = 0;
  for (const integ of integrationProjectMap) {
    const numSyncs = random(5, 15);
    const syncs: any[] = [];
    for (let s = 0; s < numSyncs; s++) {
      const syncDate = randomDate(threeMonthsAgo, now);
      syncs.push({
        integration_id: integ.id, project_id: integ.projectId,
        status: randomPick(['success', 'success', 'success', 'failed', 'partial']),
        items_synced: random(10, 200), duration_ms: random(500, 15000),
        error_message: randomBool(0.1) ? 'Timeout connecting to provider API' : null,
        created_at: syncDate,
      });
    }
    await mongoose.connection.collection('sync_history').insertMany(syncs);
    totalSyncs += numSyncs;
  }
  console.log(`  Created ${totalSyncs} sync history records`);

  // ==================== 19. GIT RELEASES ====================
  console.log('\n--- Creating Git Releases ---');
  let totalReleases = 0;
  for (const repoId of repoIds) {
    const numReleases = random(2, 6);
    const releases: any[] = [];
    for (let r = 0; r < numReleases; r++) {
      const releaseDate = randomDate(threeMonthsAgo, now);
      releases.push({
        repository_id: repoId, project_id: repoProjectMap[repoId],
        tag_name: `v${random(1, 3)}.${random(0, 9)}.${random(0, 20)}`,
        name: `Release ${randomPick(['', 'Hotfix ', 'Feature ', 'Patch '])}${random(100, 999)}`,
        description: randomPick(['Bug fixes and performance improvements', 'New feature release', 'Security patches', 'Major feature launch']),
        author: randomPick(userEmails), published_at: releaseDate,
        is_prerelease: randomBool(0.2), is_deleted: false, created_at: releaseDate,
      });
    }
    await mongoose.connection.collection('git_releases').insertMany(releases);
    totalReleases += numReleases;
  }
  console.log(`  Created ${totalReleases} git releases`);

  // ==================== 20. AI CONVERSATIONS ====================
  console.log('\n--- Creating AI Conversations ---');
  let totalConvos = 0;
  for (const proj of projectData) {
    const numConvos = random(3, 8);
    for (let c = 0; c < numConvos; c++) {
      const convoDate = randomDate(threeMonthsAgo, now);
      const messages = Array.from({ length: random(2, 6) }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: i % 2 === 0
          ? randomPick(['What is the current sprint velocity?', 'Show me the risk analysis', 'Generate a project summary', 'What are the top blockers?', 'Predict completion date'])
          : generateAiResponse('summary', proj.name),
        timestamp: new Date(convoDate.getTime() + i * 60000),
      }));
      await mongoose.connection.collection('ai_conversations').insertOne({
        project_id: proj.id, session_id: uuidv4(), messages,
        context_summary: `Discussion about ${proj.name} project health and delivery.`,
        is_active: randomBool(0.3), is_deleted: false,
        created_at: convoDate, updated_at: new Date(),
      });
      totalConvos++;
    }
  }
  console.log(`  Created ${totalConvos} AI conversations`);

  // ==================== SUMMARY ========================
  console.log('\n========================================');
  console.log('  SEED COMPLETE - Summary');
  console.log('========================================');
  console.log(`  Organizations:     ${orgIds.length}`);
  console.log(`  Team Members:      ${userIds.length}`);
  console.log(`  Projects:          ${projectData.length}`);
  console.log(`  Project Members:   ${totalMembers}`);
  console.log(`  Integrations:      ${integrationIds.length}`);
  console.log(`  Git Repositories:  ${repoIds.length}`);
  console.log(`  Sprints:           ${sprintData.length}`);
  console.log(`  Work Items:        ${workItemData.length}`);
  console.log(`  Commits:           ${totalCommits}`);
  console.log(`  Pull Requests:     ${totalPRs}`);
  console.log(`  Git Releases:      ${totalReleases}`);
  console.log(`  Analytics Snapshots: ${totalSnapshots}`);
  console.log(`  Risk Predictions:  ${totalRisks}`);
  console.log(`  AI Insights:       ${totalInsights}`);
  console.log(`  AI Conversations:  ${totalConvos}`);
  console.log(`  Notifications:     ${totalNotifications}`);
  console.log(`  Reports:           ${totalReports}`);
  console.log(`  Milestones:        ${totalMilestones}`);
  console.log(`  Dependencies:      ${totalDeps}`);
  console.log(`  Sync History:      ${totalSyncs}`);
  console.log('========================================');

  await mongoose.disconnect();
  console.log('\nDone! Data seeded successfully.');
}

// ======================== RUN ========================
run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});