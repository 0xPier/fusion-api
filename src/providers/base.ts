/**
 * Provider abstraction (guardrail G8). Every provider — local or cloud, native
 * or OpenAI-compatible — implements this one interface, so the fusion pipeline
 * and the server never special-case a vendor.
 */

export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: Role;
  content: string;
  name?: string;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Normalized request handed to a provider. `stream` is handled separately. */
export interface ProviderChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
  /** Per-call cancellation (per-model timeout + global fusion deadline). */
  signal?: AbortSignal;
}

export interface ProviderChatResult {
  content: string;
  finishReason: string | null;
  usage?: Usage;
  /** Echoed back; never logged (may carry sensitive prompt content). */
  model: string;
}

export interface ProviderStreamChunk {
  delta: string;
  finishReason?: string | null;
  usage?: Usage;
}

export interface ProviderModel {
  id: string;
  provider: string;
}

export interface HealthStatus {
  ok: boolean;
  detail?: string;
  latencyMs?: number;
}

export interface CostEstimate {
  usd: number;
  /** false when no pricing data exists (local models, unknown cloud models). */
  priced: boolean;
}

export interface TokenCounts {
  promptTokens: number;
  completionTokens: number;
}

export interface Provider {
  readonly id: string;
  readonly name: string;
  readonly type: "local" | "cloud";

  chatCompletion(req: ProviderChatRequest): Promise<ProviderChatResult>;

  /** Present only on providers that support pass-through SSE (OpenAI-compatible). */
  chatCompletionStream?(req: ProviderChatRequest): AsyncIterable<ProviderStreamChunk>;

  listModels?(): Promise<ProviderModel[]>;

  healthCheck(): Promise<HealthStatus>;

  /** Present only when the provider has pricing data. */
  estimateCost?(tokens: TokenCounts, model: string): CostEstimate;
}

/** A pointer to "call this model on this provider", optionally at this base URL. */
export interface ModelRef {
  /** Provider id (e.g. "openrouter", "ollama") OR a named model id from config. */
  provider: string;
  model: string;
  base_url?: string;
}

export interface ResolvedModel {
  provider: Provider;
  /** Upstream model name to send to the provider. */
  model: string;
}

export interface ProviderRegistry {
  /** Registered provider by id, or undefined. */
  get(providerId: string): Provider | undefined;

  /**
   * Resolve a ref to a concrete provider + upstream model name. Applies
   * allow/deny lists, model-id validation, and local-URL validation; may build
   * an ephemeral OpenAI-compatible provider for an ad-hoc `base_url`.
   * Throws FusionError on unknown/denied providers or invalid refs.
   */
  resolve(ref: ModelRef): ResolvedModel;

  /** All registered providers. */
  list(): Provider[];

  /** Configured + provider-advertised models (best-effort). */
  listModels(): Promise<ProviderModel[]>;

  /** Per-provider health. */
  health(): Promise<Record<string, HealthStatus>>;
}
