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

export const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const HEALTH_TIMEOUT_MS = 5_000;

/**
 * Native Gemini generateContent adapter. The API key goes in the
 * `x-goog-api-key` header (NOT the URL) so it never lands in a logged URL
 * (guardrail G2). Roles map user→user, assistant→model; system→systemInstruction.
 */
export class GeminiProvider implements Provider {
  readonly id = "gemini";
  readonly name = "Google Gemini";
  readonly type = "cloud" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(apiKey: string, baseUrl = GEMINI_DEFAULT_BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private headers(): Record<string, string> {
    return { "content-type": "application/json", "x-goog-api-key": this.apiKey };
  }

  async chatCompletion(req: ProviderChatRequest): Promise<ProviderChatResult> {
    const { systemInstruction, contents } = toGeminiContents(req.messages);
    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.top_p !== undefined) generationConfig.topP = req.top_p;
    if (req.max_tokens !== undefined) generationConfig.maxOutputTokens = req.max_tokens;
    if (req.stop !== undefined)
      generationConfig.stopSequences = Array.isArray(req.stop) ? req.stop : [req.stop];

    const body: Record<string, unknown> = { contents };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/models/${encodeURIComponent(req.model)}:generateContent`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (err) {
      throw FusionError.provider(`gemini: request failed: ${(err as Error).message}`, {
        provider: this.id,
      });
    }
    if (!res.ok) {
      const text = await safeText(res);
      throw FusionError.provider(`gemini: upstream ${res.status} ${res.statusText}`, {
        provider: this.id,
        status: res.status,
        body: text.slice(0, 500),
      });
    }
    const data = (await res.json()) as GeminiResponse;
    const candidate = data.candidates?.[0];
    const content = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    return {
      content,
      finishReason: candidate?.finishReason ?? null,
      usage: data.usageMetadata
        ? {
            prompt_tokens: data.usageMetadata.promptTokenCount ?? 0,
            completion_tokens: data.usageMetadata.candidatesTokenCount ?? 0,
            total_tokens:
              data.usageMetadata.totalTokenCount ??
              (data.usageMetadata.promptTokenCount ?? 0) +
                (data.usageMetadata.candidatesTokenCount ?? 0),
          }
        : undefined,
      model: req.model,
    };
  }

  async listModels(): Promise<ProviderModel[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      return (data.models ?? []).map((m) => ({
        id: m.name.replace(/^models\//, ""),
        provider: this.id,
      }));
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

function toGeminiContents(messages: ProviderChatRequest["messages"]): {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
} {
  const systemParts: string[] = [];
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
      continue;
    }
    const role: "user" | "model" = m.role === "assistant" ? "model" : "user";
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push({ text: m.content });
    else contents.push({ role, parts: [{ text: m.content }] });
  }
  return {
    systemInstruction:
      systemParts.length > 0 ? { parts: [{ text: systemParts.join("\n\n") }] } : undefined,
    contents,
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string | null;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}
