import { Router } from 'express';
import { AiIntelligenceController } from '../controller/ai_intelligence_controller';
import { aiIntelligenceMiddleware } from '../middleware/ai_intelligence_middleware';
import { createTaigaPlanRoutes } from '../../integration/route/taiga_plan_route';
import { common_middleware } from '../../../helper/common_middleware';
import { hasProjectAccess, resolveUserIds } from '../../../helper/sync_access_middleware';
import { Types } from 'mongoose';

const router = Router();
const controller = new AiIntelligenceController();

// AI Chat Endpoint - POST /ai/chat
router.post('/chat', new common_middleware().validateToken, async (req, res, next) => {
  try {
    const userIds = await resolveUserIds(global.db.connection.db!, req.body.loginDetails.verifiedData.user_id);
    if (!userIds) { res.status(403).json({ message: 'Active user required.' }); return; }
    const projectId = req.body.project_id;
    if (projectId !== undefined && (typeof projectId !== 'string' || !Types.ObjectId.isValid(projectId))) {
      res.status(400).json({ message: 'Invalid project ID.' }); return;
    }
    if (projectId && !await hasProjectAccess(global.db.connection.db!, userIds, projectId)) {
      res.status(404).json({ message: 'Project not found.' }); return;
    }
    next();
  } catch { res.status(500).json({ message: 'Unable to verify chat access.' }); }
}, (req, res) => controller.chat(req, res));

// Chat conversation summary - POST /ai/chat/summary (regenerates)
// and GET /ai/chat/summary (returns stored summary only)
router.post('/chat/summary', (req, res) => controller.generateChatSummary(req, res));
router.get('/chat/summary', (req, res) => controller.getChatSummary(req, res));

// Provider Info Endpoint - GET /ai/providers
// (returns the Grok / Ollama / Gemini tab catalog with per-tab token usage)
router.get('/providers', (req, res) => controller.getProviders(req, res));

// Provider Switch Endpoint - POST /ai/providers/switch
// (selects the active tab at runtime: gemini | groq | deepseek | ollama)
router.post('/providers/switch', (req, res) => controller.switchProvider(req, res));

// Token Usage Endpoint - GET /ai/token-usage
// (used tokens per sliding 5-hour window, split by provider tabs)
router.get('/token-usage', (req, res) => controller.getTokenUsage(req, res));

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

// Compact stored project context - POST rebuilds, GET returns the stored snapshot
router.post('/projects/:projectId/ai/context', (req, res) => controller.rebuildProjectContext(req, res));
router.get('/projects/:projectId/ai/context', (req, res) => controller.getProjectContext(req, res));

// Existing CRUD endpoints for insights
router.post('/insights', (req, res) => controller.createInsight(req, res));
router.get('/insights/:id', (req, res) => controller.getInsight(req, res));
router.put('/insights/:id', (req, res) => controller.updateInsight(req, res));
router.delete('/insights/:id', (req, res) => controller.deleteInsight(req, res));

// AI sprint-plan generator - POST /plans (input -> AI -> structured sprint/deadline plan JSON)
router.post('/plans', aiIntelligenceMiddleware.validateGeneratePlan, (req, res) => controller.generatePlan(req, res));

// List saved plans - GET /plans?project_id=... ; fetch one - GET /plans/:id
router.get('/plans', (req, res) => controller.listPlans(req, res));

// Accept a plan and track its execution
router.post('/plans/:id/accept', (req, res) => controller.acceptPlan(req, res));
router.get('/plans/:id/execution', (req, res) => controller.getPlanExecution(req, res));
router.patch('/plans/:id/execution/:kind/:itemId', aiIntelligenceMiddleware.validateToggleExecutionItem, (req, res) => controller.toggleExecutionItem(req, res));

router.get('/plans/:id', (req, res) => controller.getPlan(req, res));

// Plan-scoped Taiga publish ("Create in Taiga" button) â€” mirrors /v1/plans/:planId/*.
// Mounted at `/plans` because this router is itself mounted at `/ai`, so the
// resulting paths are /v1/ai/plans/:planId/create-in-taiga, .../create-in-taiga/preview,
// GET .../taiga-sync and POST .../taiga-sync/retry.
router.use('/plans', createTaigaPlanRoutes());

export default router;
