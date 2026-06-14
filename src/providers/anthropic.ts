import { FusionError } from "../errors.js";
import type {
  CostEstimate,
  HealthStatus,
  Provider,
  ProviderChatRequest,
  ProviderChatResult,
  ProviderModel,
  TokenCounts,
} from "./base.js";
import { estimateCostUsd } from "./pricing.js";

export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const HEALTH_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Native Anthropic Messages adapter. Differs from OpenAI: `system` is a
 * top-level field (not a message), `max_tokens` is required, and usage comes
 * back as input_tokens/output_tokens.
 */
export class AnthropicProvider implements Provider {
  readonly id = "anthropic";
  readonly name = "Anthropic";
  readonly type = "cloud" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(apiKey: string, baseUrl = ANTHROPIC_DEFAULT_BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    };
  }

  async chatCompletion(req: ProviderChatRequest): Promise<ProviderChatResult> {
    const { system, messages } = splitSystem(req.messages);
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.max_tokens ?? DEFAULT_MAX_TOKENS,
      messages,
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    if (req.stop !== undefined)
      body.stop_sequences = Array.isArray(req.stop) ? req.stop : [req.stop];

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (err) {
      throw FusionError.provider(`anthropic: request failed: ${(err as Error).message}`, {
        provider: this.id,
      });
    }
    if (!res.ok) {
      const text = await safeText(res);
      throw FusionError.provider(`anthropic: upstream ${res.status} ${res.statusText}`, {
        provider: this.id,
        status: res.status,
        body: text.slice(0, 500),
      });
    }
    const data = (await res.json()) as AnthropicResponse;
    const content = (data.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
    return {
      content,
      finishReason: data.stop_reason ?? null,
      usage: data.usage
        ? {
            prompt_tokens: data.usage.input_tokens ?? 0,
            completion_tokens: data.usage.output_tokens ?? 0,
            total_tokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
          }
        : undefined,
      model: data.model ?? req.model,
    };
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
    return estimateCostUsd(tokens, model);
  }
}

/** Pull system messages into a top-level string; merge consecutive same-role turns. */
function splitSystem(messages: ProviderChatRequest["messages"]): {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systemParts: string[] = [];
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
      continue;
    }
    const role: "user" | "assistant" = m.role === "assistant" ? "assistant" : "user";
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n\n${m.content}`;
    else turns.push({ role, content: m.content });
  }
  return { system: systemParts.join("\n\n"), messages: turns };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

interface AnthropicResponse {
  model?: string;
  stop_reason?: string | null;
  content?: Array<{ type: string; text: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}
