import express from 'express';
import { auth_routing } from './domain/auth/route/auth_routes';
import organizationRoutes from './domain/organization/route/organization_route';
import integrationRoutes from './domain/integration/route/integration_route';
import gitIntelligenceRoutes from './domain/git_intelligence/route/git_intelligence_route';
import userRoutes from './domain/user/route/user_route';
import projectRoutes from './domain/project/route/project_route';
import workManagementRoutes from './domain/work_management/route/work_management_route';
import sprintIntelligenceRoutes from './domain/sprint_intelligence/route/sprint_intelligence_route';
import analyticsRoutes from './domain/analytics/route/analytics_route';
import riskPredictionRoutes from './domain/risk_prediction/route/risk_prediction_route';
import aiIntelligenceRoutes from './domain/ai_intelligence/route/ai_intelligence_route';
import reportingRoutes from './domain/reporting/route/reporting_route';
import notificationRoutes from './domain/notification/route/notification_route';

import { OrganizationController } from './domain/organization/controller/organization_controller';
import { AiIntelligenceController } from './domain/ai_intelligence/controller/ai_intelligence_controller';
import { aiIntelligenceMiddleware } from './domain/ai_intelligence/middleware/ai_intelligence_middleware';

/**
 * Route aggregator (plan §3 / §16.1) — a sub-`express()` app mounted at `/v1`.
 *
 * Each plan domain mounts here as its own router. Domains 07–13 are CRUD
 * skeletons following the same structure as the `user` domain (route ->
 * controller -> service -> model), pending their analytics/ML/AI logic.
 */
const app_route = express();
const organizationController = new OrganizationController();
const aiController = new AiIntelligenceController();

app_route.use('/user', auth_routing);
app_route.use('/organizations', organizationRoutes);
app_route.use('/integrations', integrationRoutes);
app_route.use('/git_intelligence', gitIntelligenceRoutes);
app_route.use('/users', userRoutes);
app_route.use('/projects', projectRoutes);
app_route.use('/work-items', workManagementRoutes);
app_route.use('/sprints', sprintIntelligenceRoutes);
app_route.use('/analytics', analyticsRoutes);
app_route.use('/risk-predictions', riskPredictionRoutes);
app_route.use('/ai', aiIntelligenceRoutes);
app_route.use('/reports', reportingRoutes);
app_route.use('/notifications', notificationRoutes);

// Root-level AI sprint-plan generator (frontend calls POST /v1/plans).
// Alias of /v1/ai/plans — input -> AI -> structured sprint/deadline plan JSON.
const planRoutes = express.Router();
planRoutes.post('/', aiIntelligenceMiddleware.validateGeneratePlan, (req, res) => aiController.generatePlan(req, res));
planRoutes.get('/', (req, res) => aiController.listPlans(req, res));
planRoutes.get('/:id', (req, res) => aiController.getPlan(req, res));
app_route.use('/plans', planRoutes);

// Root-level workforce endpoint (plan §03): departments of an organization.
// Mounted outside the organization router so the frontend can call
// GET /v1/departments?organization_id=... directly.
app_route.get('/departments', organizationController.listDepartments);
app_route.get('/departments/:id/metrics', organizationController.getDepartmentMetrics);

export default app_route;
