import { Router } from 'express';
import { ProjectController } from '../controller/project_controller';
import { projectMiddleware } from '../middleware/project_middleware';
import { WorkManagementController } from '../../work_management/controller/work_management_controller';
import { SprintIntelligenceController } from '../../sprint_intelligence/controller/sprint_intelligence_controller';
import { AnalyticsController } from '../../analytics/controller/analytics_controller';
import { RiskPredictionController } from '../../risk_prediction/controller/risk_prediction_controller';
import { IntegrationController } from '../../integration/controller/integration_controller';
import { GitIntelligenceController } from '../../git_intelligence/controller/git_intelligence_controller';

const router = Router();
const controller = new ProjectController();
const workController = new WorkManagementController();
const sprintController = new SprintIntelligenceController();
const analyticsController = new AnalyticsController();
const riskController = new RiskPredictionController();
const integrationController = new IntegrationController();
const gitController = new GitIntelligenceController();

router.post('/', projectMiddleware.validateCreate, controller.createProject);
router.get('/', controller.listProjects);

// Project-scoped routes (must be before /:id to avoid conflict)
router.get('/:projectId/work-items', workController.listByProject);
router.get('/:projectId/sprints', sprintController.listByProject);
router.get('/:projectId/analytics', analyticsController.getByProject);
router.get('/:projectId/predictions', riskController.getByProject);
router.get('/:projectId/predictions/completion', riskController.getCompletionForecast);
router.get('/:projectId/integrations', integrationController.getByProject);
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
router.get('/:projectId/analytics/trends', analyticsController.getTrends);
router.get('/:projectId/risks', riskController.getRisks);
router.get('/:projectId/git/metrics', gitController.getMetrics);
router.get('/:projectId/git/activity', gitController.getActivity);

router.get('/:id', controller.getProject);
router.put('/:id', projectMiddleware.validateUpdate, controller.updateProject);
router.delete('/:id', controller.deleteProject);

export default router;
