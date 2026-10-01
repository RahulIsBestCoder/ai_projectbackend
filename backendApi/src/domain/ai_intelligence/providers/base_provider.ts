/**
 * `IAiProvider` – Contract that every AI vendor provider must implement.
 * Keeps the AI layer vendor-agnostic so business logic is never locked
 * to a single provider (plan: providers/base_provider.ts).
 *
 * Token metering: every provider reports the token counts of the last
 * completed `generate()` call through `lastUsage`. When the upstream API
 * does not return usage metadata, providers fall back to `estimateTokens`
 * so the per-window token tabs always have a number to show.
 */

export interface AiTokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface IAiProvider {
  /** Provider key — 'gemini' | 'groq' | 'deepseek' | 'ollama' | ... */
  readonly type: string;
  /** Human-friendly provider label, e.g. "Google Gemini". */
  readonly name: string;
  /** Model identifier actually used by this provider instance. */
  readonly model: string;
  /** Generate a single-shot text completion for the given prompt. */
  generate(prompt: string): Promise<string>;
  /** List the model identifiers available for this provider. */
  getModels(): Promise<string[]>;
  /** Token meter for the last generate() call (null until first call). */
  lastUsage: AiTokenUsage | null;
}

/**
 * Deterministic token estimator used when an upstream API does not return
 * usage metadata (e.g. local Ollama or a connector without counts).
 * Roughly 4 characters per token — the standard approximation.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).length / 4));
}
