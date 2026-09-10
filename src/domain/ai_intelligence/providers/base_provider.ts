/**
 * `IAiProvider` – Contract that every AI vendor provider must implement.
 * Keeps the AI layer vendor-agnostic so business logic is never locked
 * to a single provider (plan: providers/base_provider.ts).
 */
export interface IAiProvider {
  /** Generate a single-shot text completion for the given prompt. */
  generate(prompt: string): Promise<string>;
  /** List the model identifiers available for this provider. */
  getModels(): Promise<string[]>;
}
