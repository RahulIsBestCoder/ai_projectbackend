import { IAiProvider } from './base_provider';
import { GoogleProvider } from './google_provider';

/**
 * `ProviderFactory` – Creates and manages AI provider instances.
 * Supports multi-vendor provider strategy with fallback behavior.
 * 
 * Environment variables for provider selection:
 *  - AI_DEFAULT_PROVIDER : default provider name (default: google)
 *  - AI_FALLBACK_PROVIDER : fallback provider name (optional)
 */
export class ProviderFactory {
  private static _providers: Map<string, IAiProvider> = new Map();
  private static _providerConfigs: Array<{
    name: string;
    type: string;
    is_default: boolean;
    is_active: boolean;
  }> = [
    { name: 'Google Gemini', type: 'google', is_default: true, is_active: true },
    { name: 'OpenAI', type: 'openai', is_default: false, is_active: false },
    { name: 'Anthropic', type: 'anthropic', is_default: false, is_active: false },
    { name: 'Ollama', type: 'ollama', is_default: false, is_active: false },
  ];

  /**
   * Get a provider instance by type. Creates and caches the instance.
   */
  public static getProvider(type?: string): IAiProvider {
    const providerName = type || process.env.AI_DEFAULT_PROVIDER || 'google';
    
    // Return cached instance if available
    if (this._providers.has(providerName)) {
      return this._providers.get(providerName)!;
    }

    // Create new instance based on type
    let provider: IAiProvider;
    switch (providerName) {
      case 'google':
        provider = new GoogleProvider();
        break;
      // Future providers: OpenAI, Anthropic, Ollama
      // case 'openai':
      //   provider = new OpenAIProvider();
      //   break;
      // case 'anthropic':
      //   provider = new AnthropicProvider();
      //   break;
      // case 'ollama':
      //   provider = new OllamaProvider();
      //   break;
      default:
        // Default to Google if unknown provider specified
        provider = new GoogleProvider();
    }

    // Cache the instance
    this._providers.set(providerName, provider);
    return provider;
  }

  /**
   * Get the default provider instance.
   */
  public static getDefaultProvider(): IAiProvider {
    return this.getProvider('google');
  }

  /**
   * Get the fallback provider instance.
   */
  public static getFallbackProvider(): IAiProvider | null {
    const fallbackName = process.env.AI_FALLBACK_PROVIDER;
    if (fallbackName && fallbackName !== process.env.AI_DEFAULT_PROVIDER) {
      return this.getProvider(fallbackName);
    }
    return null;
  }

  /**
   * Get all available provider configurations.
   */
  public static getProviderConfigs(): Array<{
    name: string;
    type: string;
    is_default: boolean;
    is_active: boolean;
  }> {
    return this._providerConfigs;
  }

  /**
   * Generate with automatic fallback to secondary provider if primary fails.
   */
  public static async generateWithFallback(prompt: string): Promise<string> {
    const primary = this.getDefaultProvider();
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
