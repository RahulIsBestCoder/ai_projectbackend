/**
 * `verify_models_fallback` – live verification for the `GET /ai/models`
 * resilience fix: for each provider tab the endpoint must always return a
 * model list (live from the vendor when reachable, static fallback otherwise)
 * and never throw. Run with: npm run verify:models
 */
import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';

// Minimal global shims so the service runs outside the app:
//  - global.logs : provider/service logging sink
//  - global.db   : mongoose instance (schema definition only — no connection needed)
(global as any).logs = {
  writelog: (name: string, msg: unknown, severity: string) => {
    console.log(`[${severity}] ${name} :: ${Array.isArray(msg) ? msg.join(' ') : String(msg)}`);
  },
};
(global as any).db = mongoose;

import { ProviderFactory } from '../domain/ai_intelligence/providers/provider_factory';
import { AiIntelligenceService } from '../domain/ai_intelligence/service/ai_intelligence_service';

async function main(): Promise<void> {
  const service = new AiIntelligenceService();
  let failed = false;

  for (const type of ['groq', 'ollama', 'gemini']) {
    ProviderFactory.setActiveProvider(type);
    try {
      const models = await service.getAvailableModels();
      console.log(`\n=== ${type} -> OK (${models.length} models) ===`);
      console.log(JSON.stringify(models));
    } catch (err: any) {
      failed = true;
      console.error(`\n=== ${type} -> THREW (endpoint would 400): ${err?.message || err}`);
    }
  }

  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS — /ai/models never hard-fails on any tab');
  process.exit(failed ? 1 : 0);
}

main();
