import { IAiProvider, AiTokenUsage } from './base_provider';
import { GoogleProvider } from './google_provider';
import { GroqProvider } from './groq_provider';
import { DeepSeekProvider } from './deepseek_provider';
import { OllamaProvider } from './ollama_provider';
import { NvidiaProvider } from './nvidia_provider';

/**
 * `ProviderFactory` – Creates and manages AI provider instances.
 * Supports multi-vendor provider strategy with fallback behavior and
 * runtime provider switching (the Grok / Ollama / Gemini tabs in the
 * AI provider section of the UI).
 *
 * Environment variables for provider selection:
 *  - AI_DEFAULT_PROVIDER  : default provider key (default: gemini)
 *  - AI_FALLBACK_PROVIDER : fallback provider key (optional)
 *  - AI_USAGE_WINDOW_MS   : sliding usage window in ms (default: 5h = 18000000)
 */
export interface AiProviderConfig {
  /** Provider key — 'gemini' | 'groq' | 'deepseek' | 'ollama'. Shown on the tab. */
  type: string;
  /** Human-friendly provider label, e.g. "Groq". */
  name: string;
  /** Model actually used by this provider. */
  model: string;
  is_default: boolean;
  is_active: boolean;
  /** true when the provider has the credentials/config needed to run. */
  configured: boolean;
}

export class ProviderFactory {
  private static _providers: Map<string, IAiProvider> = new Map();
  private static _activeType: string | null = null;
  private static _selectedModels: Map<string, string> = new Map();
  private static _lastUsage: Map<string, AiTokenUsage> = new Map();

  public static recordUsage(provider: IAiProvider): void {
    if (provider.lastUsage) this._lastUsage.set(provider.type, { ...provider.lastUsage });
  }

  /**
   * Create a fresh provider instance by key (used to seed the cache).
   */
  private static _createProvider(type: string, model?: string): IAiProvider {
    switch (type) {
      case 'groq':
        return new GroqProvider(model);
      case 'deepseek':
        return new DeepSeekProvider(model);
      case 'ollama':
        return new OllamaProvider(model);
      case 'nvidia':
        return new NvidiaProvider(model);
      case 'gemini':
      case 'google':
        return new GoogleProvider(model);
      default:
        throw new Error(`Unknown AI provider "${type}". Supported: gemini, groq, deepseek, ollama, nvidia.`);
    }
  }

  /**
   * Get a provider instance by type. Creates and caches the instance.
   */
  public static getProvider(type?: string): IAiProvider {
    const providerName = this.normalize(type || this.getActiveType());
    const selectedModel = this._selectedModels.get(providerName);
    const cacheKey = `${providerName}:${selectedModel || 'configured-default'}`;

    // Return cached instance if available
    if (this._providers.has(cacheKey)) {
      return this._providers.get(cacheKey)!;
    }

    const provider = this._createProvider(providerName, selectedModel);

    // Cache the instance
    this._providers.set(cacheKey, provider);
    return provider;
  }

  /**
   * Get the default provider instance.
   */
  public static getDefaultProvider(): IAiProvider {
    return this.getProvider(process.env.AI_DEFAULT_PROVIDER || 'gemini');
  }

  /**
   * Switch the active provider at runtime (Grok / Ollama / Gemini tabs).
   * Returns true on success, false when the key is unknown.
   */
  public static setActiveProvider(type: string, model?: string): boolean {
    const normalized = String(type || '').trim().toLowerCase();
    if (!['groq', 'deepseek', 'ollama', 'gemini', 'google', 'nvidia'].includes(normalized)) {
      return false;
    }
    this._activeType = normalized === 'google' ? 'gemini' : normalized;
    if (model !== undefined) {
      const selected = String(model).trim();
      if (!selected) return false;
      this._selectedModels.set(this._activeType, selected);
    }
    return true;
  }

  /** Current active provider key. */
  public static getActiveType(): string {
    return this.normalize(this._activeType || process.env.AI_DEFAULT_PROVIDER || 'gemini');
  }

  private static normalize(type: string): string {
    if (typeof type !== 'string') throw new Error('provider must be a string.');
    const key = type.trim().toLowerCase();
    if (!['google', 'gemini', 'groq', 'deepseek', 'ollama', 'nvidia'].includes(key)) throw new Error(`Unknown AI provider "${key}".`);
    return key === 'google' ? 'gemini' : key;
  }

  public static async readyProvider(type?: string, model?: string): Promise<IAiProvider> {
    const base = this.getProvider(type);
    if (model !== undefined && (typeof model !== 'string' || !model.trim())) throw new Error('model must be a non-empty string.');
    const selected = model?.trim() || base.model;
    const models = await base.getModels();
    if (!models.includes(selected)) {
      throw new Error(`Model "${selected}" is unavailable for ${base.type}. Available models: ${models.join(', ') || 'none'}.`);
    }
    // Separate instances keep per-request usage and model selection isolated.
    if (base.type === 'ollama') return new OllamaProvider(selected);
    if (base.type === 'groq') return new GroqProvider(selected);
    if (base.type === 'deepseek') return new DeepSeekProvider(selected);
    if (base.type === 'nvidia') return new NvidiaProvider(selected);
    return new GoogleProvider(selected);
  }

  public static async health(type: string): Promise<any> {
    const provider = this.getProvider(type);
    try {
      const models = await provider.getModels();
      const ready = models.includes(provider.model);
      return { reachable: true, ready, models, error: ready ? null : `Configured model "${provider.model}" is unavailable.` };
    } catch (err: any) {
      return { reachable: false, ready: false, models: [], error: err.message };
    }
  }

  /**
   * Get the fallback provider instance.
   */
  public static getFallbackProvider(): IAiProvider | null {
    const fallbackName = process.env.AI_FALLBACK_PROVIDER;
    if (fallbackName && fallbackName !== this.getActiveType()) {
      return this.getProvider(fallbackName);
    }
    return null;
  }

  /**
   * Compute whether a provider is configured (has the env it needs).
   */
  private static _isConfigured(type: string): boolean {
    switch (type) {
      case 'groq':
        return Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.startsWith('gsk_'));
      case 'deepseek': {
        const key = process.env.DEEPSEEK_API_KEY || '';
        return Boolean(key && !key.toLowerCase().includes('changeme') && !key.toLowerCase().startsWith('demo-'));
      }
      case 'gemini':
      case 'google':
        return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
      case 'ollama':
        return true; // local server — always selectable (fails gracefully if offline)
      case 'nvidia': {
        const key = process.env.NVIDIA_API_KEY || '';
        return Boolean(key && !key.toLowerCase().includes('changeme') && !key.toLowerCase().startsWith('demo-'));
      }
      default:
        return false;
    }
  }

  /**
   * Get all available provider configurations (the tab catalog).
   */
  public static getProviderConfigs(): AiProviderConfig[] {
    const active = this.getActiveType();
    const defs: Array<{ type: string; name: string; model: string; is_default: boolean }> = [
      { type: 'gemini', name: 'Google Gemini', model: this._selectedModels.get('gemini') || process.env.GEMINI_MODEL || 'gemini-1.5-flash', is_default: (process.env.AI_DEFAULT_PROVIDER || 'gemini') === 'gemini' },
      { type: 'groq', name: 'Groq', model: this._selectedModels.get('groq') || process.env.GROQ_MODEL || 'openai/gpt-oss-20b', is_default: (process.env.AI_DEFAULT_PROVIDER || '') === 'groq' },
      { type: 'deepseek', name: 'DeepSeek', model: this._selectedModels.get('deepseek') || process.env.DEEPSEEK_MODEL || 'deepseek-chat', is_default: (process.env.AI_DEFAULT_PROVIDER || '') === 'deepseek' },
      { type: 'ollama', name: 'Ollama (local)', model: this._selectedModels.get('ollama') || process.env.OLLAMA_MODEL || 'llama3.1', is_default: (process.env.AI_DEFAULT_PROVIDER || '') === 'ollama' },
      { type: 'nvidia', name: 'NVIDIA NIM', model: this._selectedModels.get('nvidia') || process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct', is_default: (process.env.AI_DEFAULT_PROVIDER || '') === 'nvidia' },
    ];
    return defs.map((d) => ({
      ...d,
      is_active: d.type === active,
      configured: this._isConfigured(d.type),
    }));
  }

  /**
   * Token meter for the last generate() of the given provider (or active one).
   */
  public static getLastUsage(type?: string): AiTokenUsage | null {
    const key = type || this.getActiveType();
    const provider = this._providers.get(`${key}:${this._selectedModels.get(key) || 'configured-default'}`);
    return this._lastUsage.get(key) || (provider ? provider.lastUsage : null);
  }

  /**
   * Sliding usage window length in ms — "used tokens per 5 hours".
   */
  public static getUsageWindowMs(): number {
    return Number(process.env.AI_USAGE_WINDOW_MS) || 5 * 60 * 60 * 1000;
  }

  /**
   * Generate with automatic fallback to secondary provider if primary fails.
   */
  public static async generateWithFallback(prompt: string): Promise<string> {
    const primary = this.getProvider();
    try {
      return await primary.generate(prompt);
    } catch (primaryError) {
      const fallback = this.getFallbackProvider();
      if (fallback) {
        return await fallback.generate(prompt);
      }
      throw primaryError;
    }
  }
}
