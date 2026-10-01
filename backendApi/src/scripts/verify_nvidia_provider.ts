import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NvidiaProvider } from '../domain/ai_intelligence/providers/nvidia_provider';
import { ProviderFactory } from '../domain/ai_intelligence/providers/provider_factory';

(global as any).db = mongoose;
(global as any).logs = { writelog: () => {} };

async function main() {
  const previousKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = 'test-nvidia-key';
  try {
    const provider = new NvidiaProvider('meta/llama-3.3-70b-instruct');
    (provider as any)._client = {
      models: { list: async () => ({ data: [{ id: 'nvidia/model-b' }, { id: 'meta/llama-3.3-70b-instruct' }] }) },
      chat: { completions: { create: async (request: any) => {
        assert.equal(request.model, 'meta/llama-3.3-70b-instruct');
        return { choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 } };
      } } },
    };
    assert.deepEqual(await provider.getModels(), ['meta/llama-3.3-70b-instruct', 'nvidia/model-b']);
    assert.equal(await provider.generate('test'), 'OK');
    assert.equal(provider.lastUsage?.total_tokens, 5);
    assert.equal(ProviderFactory.getProviderConfigs().find(item => item.type === 'nvidia')?.configured, true);
    assert.equal(ProviderFactory.setActiveProvider('nvidia', provider.model), true);
    assert.equal(ProviderFactory.getActiveType(), 'nvidia');
    console.log('PASS: NVIDIA model listing, generation, usage, configuration, and selection.');
  } finally {
    if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousKey;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
