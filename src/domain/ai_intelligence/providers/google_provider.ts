import { IAiProvider } from './base_provider';

/**
 * `GoogleProvider` – Google Gemini implementation of `IAiProvider`.
 * Calls the Gemini REST API through native `fetch` (Node >= 18), so no
 * extra SDK dependency is required.
 *
 * Environment variables:
 *  - GEMINI_API_KEY / GOOGLE_API_KEY : API key (required)
 *  - GEMINI_MODEL                    : model name (default: gemini-1.5-flash)
 *  - AI_MAX_TOKENS                   : max output tokens (default: 1024)
 *  - AI_TEMPERATURE                  : sampling temperature (default: 0.2)
 *  - AI_MAX_RETRIES                  : max retry attempts (default: 3)
 *  - AI_RETRY_DELAY_MS               : initial retry delay in ms (default: 1000)
 */
export class GoogleProvider implements IAiProvider {
  private readonly _apiKey: string;
  private readonly _model: string;
  private readonly _baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  private readonly _maxRetries: number;
  private readonly _retryDelayMs: number;
  private readonly _timeoutMs: number;
  private readonly logName = 'google_provider';

  constructor() {
    this._apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    this._model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    this._maxRetries = Number(process.env.AI_MAX_RETRIES) || 3;
    this._retryDelayMs = Number(process.env.AI_RETRY_DELAY_MS) || 1000;
    // Hard per-request deadline so a stalled network can't hang the API
    // (route handlers must always answer — service falls back if we throw).
    this._timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 20000;
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  /**
   * Check if the error is retryable (rate limit, server error, or high demand).
   */
  private isRetryableError(errorMessage: string, httpStatus: number): boolean {
    // Retry on HTTP 429 (rate limit), 500 (server error), 503 (service unavailable)
    if (httpStatus === 429 || httpStatus === 500 || httpStatus === 503) {
      return true;
    }
    // Retry on specific error messages
    const retryableMessages = [
      'high demand',
      'rate limit',
      'quota exceeded',
      'try again later',
      'server error',
      'service unavailable',
      'timeout',
    ];
    return retryableMessages.some((msg) => errorMessage.toLowerCase().includes(msg));
  }

  /**
   * Sleep for a specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** @Developer @Date @Function generate */
  public async generate(prompt: string): Promise<string> {
    if (!this._apiKey) {
      throw new Error('Missing GEMINI_API_KEY (or GOOGLE_API_KEY) in environment.');
    }
    this.log('generate', [`Model : ${this._model}`, 'Prompt : ', prompt]);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Exponential backoff: delay * 2^attempt
          const delay = this._retryDelayMs * Math.pow(2, attempt - 1);
          this.log('generate', `Retry attempt ${attempt}/${this._maxRetries} after ${delay}ms delay`);
          await this.sleep(delay);
        }

        const url = `${this._baseUrl}/models/${this._model}:generateContent?key=${this._apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: Number(process.env.AI_MAX_TOKENS) || 1024,
              temperature: Number(process.env.AI_TEMPERATURE) || 0.2,
            },
          }),
          signal: AbortSignal.timeout(this._timeoutMs),
        });

        const data: any = await response.json();
        
        if (!response.ok) {
          const message = data?.error?.message || `Gemini API error (HTTP ${response.status})`;
          
          // Check if this is a retryable error
          if (this.isRetryableError(message, response.status) && attempt < this._maxRetries) {
            this.log('generate', `Retryable error: ${message}`, 'WARN');
            lastError = new Error(message);
            continue; // Retry
          }
          
          // Non-retryable error or max retries reached
          throw new Error(message);
        }

        const text: string =
          data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text).filter(Boolean).join('') || '';
        if (!text) {
          throw new Error('Gemini API returned an empty response.');
        }
        this.log('generate', 'Response received successfully.');
        return text;
      } catch (err: any) {
        this.log('generate', err?.stack || err, 'ERROR');
        lastError = err;
        
        // If it's not a retryable error, throw immediately
        if (err.message && !this.isRetryableError(err.message, 0)) {
          throw err;
        }
      }
    }

    // All retries exhausted
    throw lastError || new Error('Max retries exceeded');
  }

  /** @Developer @Date @Function getModels */
  public async getModels(): Promise<string[]> {
    if (!this._apiKey) {
      throw new Error('Missing GEMINI_API_KEY (or GOOGLE_API_KEY) in environment.');
    }
    this.log('getModels', 'Fetching available Gemini models.');
    try {
      const url = `${this._baseUrl}/models?key=${this._apiKey}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(this._timeoutMs) });
      const data: any = await response.json();
      if (!response.ok) {
        const message = data?.error?.message || `Gemini API error (HTTP ${response.status})`;
        throw new Error(message);
      }
      const models: string[] = (data?.models || [])
        .filter((model: any) => (model?.supportedGenerationMethods || []).includes('generateContent'))
        .map((model: any) => String(model.name).replace(/^models\//, ''));
      this.log('getModels', [`Found ${models.length} models.`]);
      return models;
    } catch (err: any) {
      this.log('getModels', err?.stack || err, 'ERROR');
      throw err;
    }
  }
}
