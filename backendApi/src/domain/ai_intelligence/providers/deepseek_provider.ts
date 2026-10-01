import OpenAI from 'openai';
import { IAiProvider, AiTokenUsage, estimateTokens } from './base_provider';

/**
 * DeepSeek provider using its OpenAI-compatible Chat Completions API.
 *
 * Environment variables:
 *  - DEEPSEEK_API_KEY  : DeepSeek API key (required)
 *  - DEEPSEEK_MODEL    : model name (default: deepseek-chat)
 *  - DEEPSEEK_BASE_URL : API base URL (default: https://api.deepseek.com)
 */
export class DeepSeekProvider implements IAiProvider {
  public readonly type = 'deepseek';
  public readonly name = 'DeepSeek';
  public get model(): string {
    return this._model;
  }
  public lastUsage: AiTokenUsage | null = null;

  private readonly _apiKey: string;
  private readonly _model: string;
  private readonly _client: OpenAI;
  private readonly logName = 'deepseek_provider';

  constructor(model?: string) {
    this._apiKey = process.env.DEEPSEEK_API_KEY || '';
    this._model = model || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    this._client = new OpenAI({
      apiKey: this._apiKey || 'missing',
      baseURL: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
      maxRetries: Math.max(0, Math.min(5, Number(process.env.AI_MAX_RETRIES ?? 3) || 0)),
      timeout: Number(process.env.AI_TIMEOUT_MS) || 20000,
    });
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  private validateApiKey(): void {
    const normalized = this._apiKey.toLowerCase();
    if (!this._apiKey || normalized.includes('changeme') || normalized.startsWith('demo-')) {
      throw new Error('Missing DEEPSEEK_API_KEY in environment. Add a valid DeepSeek API key and restart the backend.');
    }
  }

  /**
   * @Developer: Sougata Bauri
   * @Date: 2026-09-29
   * @Function: generate
   */
  public async generate(prompt: string): Promise<string> {
    this.validateApiKey();
    this.lastUsage = null;
    this.log('generate', `Chat Completions model: ${this._model}`);
    try {
      const response = await this._client.chat.completions.create({
        model: this._model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: Number(process.env.AI_MAX_TOKENS) || 1024,
        temperature: Number(process.env.AI_TEMPERATURE ?? 0.2),
      });
      const text = response.choices[0]?.message?.content || '';
      if (!text) throw new Error('DeepSeek API returned an empty response.');

      const promptTokens = response.usage?.prompt_tokens ?? estimateTokens(prompt);
      const completionTokens = response.usage?.completion_tokens ?? estimateTokens(text);
      this.lastUsage = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: response.usage?.total_tokens ?? promptTokens + completionTokens,
      };
      this.log('generate', 'Response received successfully.');
      return text;
    } catch (err: any) {
      this.log('generate', err?.stack || err, 'ERROR');
      throw err;
    }
  }

  /**
   * @Developer: Sougata Bauri
   * @Date: 2026-09-29
   * @Function: getModels
   */
  public async getModels(): Promise<string[]> {
    this.validateApiKey();
    this.log('getModels', 'Fetching available DeepSeek models.');
    try {
      const page = await this._client.models.list();
      const models = page.data.map((item) => item.id).filter(Boolean);
      this.log('getModels', `Found ${models.length} models.`);
      return models;
    } catch (err: any) {
      this.log('getModels', err?.stack || err, 'ERROR');
      throw err;
    }
  }
}
