import dotenv from 'dotenv';
dotenv.config();
import { ProviderFactory } from '../domain/ai_intelligence/providers/provider_factory';
(global as any).logs = { writelog: () => {} };

async function main(): Promise<void> {
  for (const type of ['groq', 'ollama', 'gemini', 'nvidia']) {
    const health = await ProviderFactory.health(type);
    console.log(JSON.stringify({ provider: type, ...health }));
  }
  const provider = await ProviderFactory.readyProvider();
  const response = await provider.generate('Reply only with OK.');
  console.log(JSON.stringify({ default_provider: provider.type, model: provider.model, response }));
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
