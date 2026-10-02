import { IAiProvider, AiTokenUsage, estimateTokens } from './base_provider';

/**
 * `OllamaProvider` – local Ollama implementation of `IAiProvider`.
 * Talks to a locally running Ollama server (`/api/chat` for generation,
 * `/api/tags` for model listing). No API key required.
 *
 * Environment variables:
 *  - OLLAMA_BASE_URL : server base URL (default: http://127.0.0.1:11434)
 *  - OLLAMA_MODEL    : model name (default: llama3.1)
 *  - AI_MAX_TOKENS   : max output tokens (default: 1024)
 *  - AI_TEMPERATURE  : sampling temperature (default: 0.2)
 *  - AI_TIMEOUT_MS   : per-request deadline (default: 20000)
 */
export class OllamaProvider implements IAiProvider {
  public readonly type = 'ollama';
  public readonly name = 'Ollama (local)';
  public get model(): string {
    return this._model;
  }
  public lastUsage: AiTokenUsage | null = null;

  private readonly _model: string;
  private readonly _baseUrl: string;
  private readonly _timeoutMs: number;
  private readonly logName = 'ollama_provider';

  constructor(model?: string) {
    this._model = model || process.env.OLLAMA_MODEL || 'llama3.1';
    this._baseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    this._timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 20000;
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  /** @Developer Sougata Bauri @Date 2026-09-13 @Function generate */
  public async generate(prompt: string): Promise<string> {
    this.lastUsage = null;
    this.log('generate', `Model: ${this._model}`);
    try {
      const url = `${this._baseUrl}/api/chat`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this._model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          options: {
            num_predict: Number(process.env.AI_MAX_TOKENS) || 1024,
            temperature: Number(process.env.AI_TEMPERATURE ?? 0.2),
          },
        }),
        signal: AbortSignal.timeout(this._timeoutMs),
      });

      const data: any = await response.json();

      if (!response.ok) {
        const message = data?.error || `Ollama API error (HTTP ${response.status})`;
        throw new Error(String(message));
      }

      const text: string = data?.message?.content || '';
      if (!text) {
        throw new Error('Ollama API returned an empty response.');
      }

      // Ollama reports prompt_eval_count / eval_count — real token counts.
      const pt = Number(data.prompt_eval_count) || estimateTokens(prompt);
      const ct = Number(data.eval_count) || estimateTokens(text);
      this.lastUsage = {
        prompt_tokens: pt,
        completion_tokens: ct,
        total_tokens: pt + ct,
      };
      this.log('generate', 'Response received successfully.');
      return text;
    } catch (err: any) {
      // Native fetch wraps connection failures as TypeError — surface a clear
      // message so the service can log "provider unavailable".
      const msg = err?.name === 'TypeError' || /(fetch|ECONNREFUSED|Failed to connect)/i.test(String(err?.message || ''))
        ? `Ollama server unreachable at ${this._baseUrl} (is Ollama running?)`
        : err?.message || err;
      this.log('generate', msg, 'ERROR');
      throw new Error(String(msg));
    }
  }

  /** @Developer Sougata Bauri @Date 2026-09-13 @Function getModels */
  public async getModels(): Promise<string[]> {
    this.log('getModels', 'Fetching available Ollama models.');
    try {
      const url = `${this._baseUrl}/api/tags`;
      const response = await fetch(url, { signal: AbortSignal.timeout(this._timeoutMs) });
      const data: any = await response.json();
      if (!response.ok) {
        throw new Error(`Ollama API error (HTTP ${response.status})`);
      }
      const models: string[] = (data?.models || []).map((m: any) => m?.name).filter((name: any) => typeof name === 'string' && name.length > 0);
      this.log('getModels', [`Found ${models.length} models.`]);
      return models;
    } catch (err: any) {
      this.log('getModels', err?.stack || err, 'ERROR');
      throw err;
    }
  }
}
