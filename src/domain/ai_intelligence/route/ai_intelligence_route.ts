import { Router } from 'express';
import { AiIntelligenceController } from '../controller/ai_intelligence_controller';
import { aiIntelligenceMiddleware } from '../middleware/ai_intelligence_middleware';

const router = Router();
const controller = new AiIntelligenceController();

// AI Chat Endpoint - POST /ai/chat
router.post('/chat', (req, res) => controller.chat(req, res));

// Chat conversation summary - POST /ai/chat/summary (regenerates)
// and GET /ai/chat/summary (returns stored summary only)
router.post('/chat/summary', (req, res) => controller.generateChatSummary(req, res));
router.get('/chat/summary', (req, res) => controller.getChatSummary(req, res));

// Provider Info Endpoint - GET /ai/providers
router.get('/providers', (req, res) => controller.getProviders(req, res));

// Models Info Endpoint - GET /ai/models
router.get('/models', (req, res) => controller.getModels(req, res));

// Project-scoped AI endpoints
// Analyze project - POST /projects/:projectId/ai/analyze
router.post('/projects/:projectId/ai/analyze', (req, res) => controller.analyzeProject(req, res));

// Generate project summary - POST /projects/:projectId/ai/summary
router.post('/projects/:projectId/ai/summary', (req, res) => controller.generateSummary(req, res));

// Generate project insights - POST /projects/:projectId/ai/insights
router.post('/projects/:projectId/ai/insights', (req, res) => controller.generateInsights(req, res));

// Generate recommendations - POST /projects/:projectId/ai/recommendations
router.post('/projects/:projectId/ai/recommendations', (req, res) => controller.generateRecommendations(req, res));

// Generate report - POST /projects/:projectId/ai/reports
router.post('/projects/:projectId/ai/reports', (req, res) => controller.generateReport(req, res));

// Get project sessions/insights history - GET /projects/:projectId/ai/sessions
router.get('/projects/:projectId/ai/sessions', (req, res) => controller.getProjectSessions(req, res));

// Existing CRUD endpoints for insights
router.post('/insights', (req, res) => controller.createInsight(req, res));
router.get('/insights/:id', (req, res) => controller.getInsight(req, res));
router.put('/insights/:id', (req, res) => controller.updateInsight(req, res));
router.delete('/insights/:id', (req, res) => controller.deleteInsight(req, res));

// AI sprint-plan generator - POST /plans (input -> AI -> structured sprint/deadline plan JSON)
router.post('/plans', aiIntelligenceMiddleware.validateGeneratePlan, (req, res) => controller.generatePlan(req, res));

// List saved plans - GET /plans?project_id=... ; fetch one - GET /plans/:id
router.get('/plans', (req, res) => controller.listPlans(req, res));
router.get('/plans/:id', (req, res) => controller.getPlan(req, res));

export default router;
