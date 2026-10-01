import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { ProviderFactory } from '../domain/ai_intelligence/providers/provider_factory';
import { AiIntelligenceService } from '../domain/ai_intelligence/service/ai_intelligence_service';
(global as any).db = mongoose;
(global as any).logs = { writelog: () => {} };
(global as any).Helpers = {
  makeBadServiceStatus: (message: string) => ({ status: false, status_message: message }),
};

async function main(): Promise<void> {
  process.env.OLLAMA_MODEL = 'installed:cloud';
  ProviderFactory.setActiveProvider('ollama');
  const originalFetch = global.fetch;
  let chatCalls = 0;
  global.fetch = (async (url: any, options: any) => {
    if (String(url).endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'installed:cloud' }, { name: 'second:cloud' }] }));
    chatCalls++;
    assert.equal(JSON.parse(options.body).model, 'second:cloud');
    return new Response(JSON.stringify({ message: { content: 'OK' }, prompt_eval_count: 3, eval_count: 1 }));
  }) as typeof fetch;
  try {
    assert.equal(ProviderFactory.getProvider(' OLLAMA ').type, 'ollama');
    assert.throws(() => ProviderFactory.getProvider('unknown'));
    await assert.rejects(ProviderFactory.readyProvider('ollama', 'missing'), /unavailable/);
    assert.equal(chatCalls, 0);
    const selected = await ProviderFactory.readyProvider('ollama', 'second:cloud');
    assert.equal(await selected.generate('test'), 'OK');
    assert.equal(ProviderFactory.getProvider().model, 'installed:cloud');
    assert.equal(ProviderFactory.getActiveType(), 'ollama');
    ProviderFactory.recordUsage(selected);
    assert.equal(ProviderFactory.getLastUsage('ollama')?.total_tokens, 4);
    const service = new AiIntelligenceService();
    global.fetch = (async () => { throw new Error('server offline'); }) as typeof fetch;
    await assert.rejects(service.getAvailableModels('ollama'), /server offline/);
    assert.equal((await ProviderFactory.health('ollama')).ready, false);
    assert.equal((await service.switchActiveProvider('gemini')).status, false);
    assert.equal(ProviderFactory.getActiveType(), 'ollama');
    console.log('PASS: model validation, request isolation, usage, offline listing, and failed switch.');
  } finally { global.fetch = originalFetch; }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
