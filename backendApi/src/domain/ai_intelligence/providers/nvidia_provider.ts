import OpenAI from 'openai';
import { IAiProvider, AiTokenUsage, estimateTokens } from './base_provider';

/** NVIDIA hosted NIM provider using its OpenAI-compatible API. */
export class NvidiaProvider implements IAiProvider {
  public readonly type = 'nvidia';
  public readonly name = 'NVIDIA NIM';
  public get model(): string { return this._model; }
  public lastUsage: AiTokenUsage | null = null;
  private readonly _apiKey: string;
  private readonly _model: string;
  private readonly _client: OpenAI;

  constructor(model?: string) {
    this._apiKey = process.env.NVIDIA_API_KEY || '';
    this._model = model || process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct';
    this._client = new OpenAI({
      apiKey: this._apiKey || 'missing',
      baseURL: (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, ''),
      maxRetries: Math.max(0, Math.min(5, Number(process.env.AI_MAX_RETRIES ?? 3) || 0)),
      timeout: Number(process.env.AI_TIMEOUT_MS) || 20000,
    });
  }

  private validateApiKey(): void {
    const key = this._apiKey.toLowerCase();
    if (!key || key.includes('changeme') || key.startsWith('demo-')) {
      throw new Error('Missing NVIDIA_API_KEY in environment. Add an NVIDIA API key and restart the backend.');
    }
  }

  public async generate(prompt: string): Promise<string> {
    this.validateApiKey();
    this.lastUsage = null;
    const response = await this._client.chat.completions.create({
      model: this._model, messages: [{ role: 'user', content: prompt }],
      max_tokens: Number(process.env.AI_MAX_TOKENS) || 1024,
      temperature: Number(process.env.AI_TEMPERATURE ?? 0.2),
    });
    const text = response.choices[0]?.message?.content || '';
    if (!text) throw new Error('NVIDIA NIM API returned an empty response.');
    const promptTokens = response.usage?.prompt_tokens ?? estimateTokens(prompt);
    const completionTokens = response.usage?.completion_tokens ?? estimateTokens(text);
    this.lastUsage = { prompt_tokens: promptTokens, completion_tokens: completionTokens,
      total_tokens: response.usage?.total_tokens ?? promptTokens + completionTokens };
    return text;
  }

  public async getModels(): Promise<string[]> {
    this.validateApiKey();
    const page = await this._client.models.list();
    return page.data.map(item => item.id).filter(Boolean).sort();
  }
}
