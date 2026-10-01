import { Router } from 'express';
import { OrganizationController } from '../../organization/controller/organization_controller';
import { ProjectController } from '../controller/project_controller';
import { projectMiddleware } from '../middleware/project_middleware';
import { common_middleware } from '../../../helper/common_middleware';
import { requireSyncAccess } from '../../../helper/sync_access_middleware';
import { GitHubController } from '../../integration/controller/github_controller';
import { WorkManagementController } from '../../work_management/controller/work_management_controller';
import { SprintIntelligenceController } from '../../sprint_intelligence/controller/sprint_intelligence_controller';
import { AnalyticsController } from '../../analytics/controller/analytics_controller';
import { RiskPredictionController } from '../../risk_prediction/controller/risk_prediction_controller';
import { IntegrationController } from '../../integration/controller/integration_controller';
import { GitIntelligenceController } from '../../git_intelligence/controller/git_intelligence_controller';
import taigaRoute from '../../integration/route/taiga_route';


const router = Router();
const controller = new ProjectController();
const workController = new WorkManagementController();
const sprintController = new SprintIntelligenceController();
const analyticsController = new AnalyticsController();
const riskController = new RiskPredictionController();
const integrationController = new IntegrationController();
const gitController = new GitIntelligenceController();
const githubController = new GitHubController();
const githubAccess = [new common_middleware().validateToken, requireSyncAccess];
router.put('/:projectId/qa-reporters/:reporterId/role', ...githubAccess, new OrganizationController().setQaReporterRole);

router.post('/:projectId/github/connect', ...githubAccess, githubController.connect);
router.post('/:projectId/github/sync', ...githubAccess, githubController.sync);
router.get('/:projectId/github/sync-status', ...githubAccess, githubController.status);
router.get('/:projectId/github/context', ...githubAccess, githubController.context);
router.post('/:projectId/github/analyze', ...githubAccess, githubController.analyze);

router.post('/', projectMiddleware.validateCreate, controller.createProject);
router.get('/', controller.listProjects);
router.get('/portfolio', new common_middleware().validateToken, controller.getPortfolio);
router.get('/ai-dashboard', new common_middleware().validateToken, controller.getAiDashboard);
router.get('/:projectId/ai-dashboard', ...githubAccess, controller.getAiDashboard);

// Project-scoped routes (must be before /:id to avoid conflict)
router.get('/:projectId/work-items', workController.listByProject);
router.get('/:projectId/sprints', sprintController.listByProject);
router.get('/:projectId/analytics', analyticsController.getByProject);
router.get('/:projectId/predictions', riskController.getByProject);
router.get('/:projectId/predictions/completion', riskController.getCompletionForecast);
router.get('/:projectId/ai/delay-prediction', riskController.getDelayPrediction);
router.post('/:projectId/ai/delay-prediction/simulate', riskController.simulateDelayPrediction);
router.post('/:projectId/predictions/deadline', new common_middleware().validateToken, requireSyncAccess, riskController.predictDeadline);
router.get('/:projectId/integrations', integrationController.getByProject);
router.post('/:projectId/sync', new common_middleware().validateToken, controller.syncProject);
router.post('/:projectId/ai-assessment/refresh', new common_middleware().validateToken, requireSyncAccess, controller.refreshAiAssessment);
router.get('/:projectId/repositories', gitController.getByProject);
router.get('/:projectId/git/commits', gitController.getCommitsByProject);
router.get('/:projectId/git/pull-requests', gitController.getPullRequestsByProject);
router.get('/:projectId/git/contributors', gitController.getContributorsByProject);
router.get('/:projectId/members', controller.listMembers);
router.get('/:projectId/milestones', controller.listMilestones);
router.get('/:projectId/dependencies', controller.listDependencies);
router.get('/:projectId/reports', controller.listReports);
router.get('/:projectId/releases', controller.listReleases);
router.get('/:projectId/health', analyticsController.getHealth);
router.get('/:projectId/health/strategies', analyticsController.getHealthStrategies);
router.get('/:projectId/health/rules-score', analyticsController.getRulesHealth);
router.get('/:projectId/analytics/trends', analyticsController.getTrends);router.get('/:projectId/risks', riskController.getRisks);
router.get('/:projectId/git/activity', gitController.getActivity);

// Taiga publish pipeline routes (all new, additive).
// Single source of truth: `integration/route/taiga_route.ts` — connect,
// test-connection, status, publish-to-taiga(/preview) and create-in-taiga.
// Mounted here and NOT re-declared inline so the project-scoped aliases cannot drift.
router.use(taigaRoute);


router.post('/:projectId/risks/analyze', new common_middleware().validateToken, requireSyncAccess, riskController.analyzeRisks);
router.get('/:projectId/git/metrics', gitController.getMetrics);

router.get('/:id', controller.getProject);
router.put('/:id', projectMiddleware.validateUpdate, controller.updateProject);
router.delete('/:id', controller.deleteProject);

export default router;
