import OpenAI from 'openai';
import { IAiProvider, AiTokenUsage, estimateTokens } from './base_provider';

/**
 * Groq provider using its OpenAI-compatible Responses API.
 *
 * Environment variables:
 *  - GROQ_API_KEY  : Groq API key (required)
 *  - GROQ_MODEL    : model name (default: openai/gpt-oss-20b)
 *  - GROQ_BASE_URL : API base URL (default: https://api.groq.com/openai/v1)
 */
export class GroqProvider implements IAiProvider {
  public readonly type = 'groq';
  public readonly name = 'Groq';
  public get model(): string {
    return this._model;
  }
  public lastUsage: AiTokenUsage | null = null;

  private readonly _apiKey: string;
  private readonly _model: string;
  private readonly _client: OpenAI;
  private readonly logName = 'groq_provider';

  constructor(model?: string) {
    this._apiKey = process.env.GROQ_API_KEY || '';
    this._model = model || process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
    this._client = new OpenAI({
      apiKey: this._apiKey || 'missing',
      baseURL: (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
      maxRetries: Math.max(0, Math.min(5, Number(process.env.AI_MAX_RETRIES ?? 3) || 0)),
      timeout: Number(process.env.AI_TIMEOUT_MS) || 20000,
    });
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  private validateApiKey(): void {
    if (!this._apiKey) {
      throw new Error('Missing GROQ_API_KEY in environment. Add a Groq API key and restart the backend.');
    }
    if (!this._apiKey.startsWith('gsk_')) {
      throw new Error('GROQ_API_KEY is not a Groq key. Expected a key beginning with gsk_.');
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
    this.log('generate', `Responses API model: ${this._model}`);
    try {
      const response = await this._client.responses.create({
        model: this._model,
        input: prompt,
        max_output_tokens: Number(process.env.AI_MAX_TOKENS) || 1024,
        temperature: Number(process.env.AI_TEMPERATURE ?? 0.2),
      });
      const text = response.output_text || '';
      if (!text) throw new Error('Groq Responses API returned an empty response.');

      const promptTokens = response.usage?.input_tokens ?? estimateTokens(prompt);
      const completionTokens = response.usage?.output_tokens ?? estimateTokens(text);
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
    this.log('getModels', 'Fetching available Groq models.');
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
