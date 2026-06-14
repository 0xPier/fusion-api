import { FusionError } from "../errors.js";
import type {
  CostEstimate,
  HealthStatus,
  Provider,
  ProviderChatRequest,
  ProviderChatResult,
  ProviderModel,
  ProviderStreamChunk,
  TokenCounts,
} from "./base.js";
import { estimateCostUsd } from "./pricing.js";

export interface OpenAICompatibleConfig {
  id: string;
  name: string;
  type: "local" | "cloud";
  baseUrl: string;
  apiKey?: string;
  /** Extra headers (e.g. OpenRouter attribution). Never logged. */
  extraHeaders?: Record<string, string>;
  /** Whether to request usage on streamed responses (cloud supports it; many local don't). */
  streamUsage?: boolean;
}

const HEALTH_TIMEOUT_MS = 5_000;

/**
 * ONE adapter for every OpenAI-compatible endpoint (guardrail G8): Ollama,
 * LM Studio, llama.cpp, OpenAI, OpenRouter. Vendors differ only by base URL,
 * auth header, and attribution headers.
 */
export class OpenAICompatibleProvider implements Provider {
  readonly id: string;
  readonly name: string;
  readonly type: "local" | "cloud";
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly streamUsage: boolean;

  constructor(cfg: OpenAICompatibleConfig) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.type = cfg.type;
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.apiKey = cfg.apiKey;
    this.extraHeaders = cfg.extraHeaders ?? {};
    this.streamUsage = cfg.streamUsage ?? cfg.type === "cloud";
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json", ...this.extraHeaders };
    if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private body(req: ProviderChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
      })),
      stream,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    if (req.max_tokens !== undefined) body.max_tokens = req.max_tokens;
    if (req.stop !== undefined) body.stop = req.stop;
    if (stream && this.streamUsage) body.stream_options = { include_usage: true };
    return body;
  }

  async chatCompletion(req: ProviderChatRequest): Promise<ProviderChatResult> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(this.body(req, false)),
        signal: req.signal,
      });
    } catch (err) {
      throw FusionError.provider(`${this.id}: request failed: ${(err as Error).message}`, {
        provider: this.id,
      });
    }
    if (!res.ok) {
      const text = await safeText(res);
      throw FusionError.provider(`${this.id}: upstream ${res.status} ${res.statusText}`, {
        provider: this.id,
        status: res.status,
        body: text.slice(0, 500),
      });
    }
    const data = (await res.json()) as OpenAIChatResponse;
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content ?? "",
      finishReason: choice?.finish_reason ?? null,
      usage: data.usage
        ? {
            prompt_tokens: data.usage.prompt_tokens ?? 0,
            completion_tokens: data.usage.completion_tokens ?? 0,
            total_tokens: data.usage.total_tokens ?? 0,
          }
        : undefined,
      model: data.model ?? req.model,
    };
  }

  async *chatCompletionStream(req: ProviderChatRequest): AsyncIterable<ProviderStreamChunk> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(this.body(req, true)),
        signal: req.signal,
      });
    } catch (err) {
      throw FusionError.provider(`${this.id}: stream request failed: ${(err as Error).message}`, {
        provider: this.id,
      });
    }
    if (!res.ok || !res.body) {
      const text = await safeText(res);
      throw FusionError.provider(`${this.id}: upstream ${res.status} ${res.statusText}`, {
        provider: this.id,
        status: res.status,
        body: text.slice(0, 500),
      });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line.
      while (true) {
        const idx = buffer.indexOf("\n\n");
        if (idx === -1) break;
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of rawEvent.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") return;
          try {
            const chunk = JSON.parse(payload) as OpenAIStreamChunk;
            const delta = chunk.choices?.[0]?.delta?.content ?? "";
            const finishReason = chunk.choices?.[0]?.finish_reason ?? null;
            const usage = chunk.usage
              ? {
                  prompt_tokens: chunk.usage.prompt_tokens ?? 0,
                  completion_tokens: chunk.usage.completion_tokens ?? 0,
                  total_tokens: chunk.usage.total_tokens ?? 0,
                }
              : undefined;
            if (delta || finishReason || usage) yield { delta, finishReason, usage };
          } catch {
            // ignore malformed keep-alive / comment lines
          }
        }
      }
    }
  }

  async listModels(): Promise<ProviderModel[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      return (data.data ?? []).map((m) => ({ id: m.id, provider: this.id }));
    } catch {
      return [];
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      return {
        ok: res.ok,
        detail: res.ok ? undefined : `HTTP ${res.status}`,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return { ok: false, detail: (err as Error).message, latencyMs: Date.now() - start };
    }
  }

  estimateCost(tokens: TokenCounts, model: string): CostEstimate {
    // Local providers have no pricing data → priced:false (cost 0).
    if (this.type === "local") return { usd: 0, priced: false };
    return estimateCostUsd(tokens, model);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

interface OpenAIChatResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface OpenAIStreamChunk {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}
