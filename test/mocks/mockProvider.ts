import { FusionError } from "../../src/errors.js";
import type {
  CostEstimate,
  HealthStatus,
  Provider,
  ProviderChatRequest,
  ProviderChatResult,
  ProviderStreamChunk,
  TokenCounts,
} from "../../src/providers/base.js";

export type MockScript =
  | {
      kind: "ok";
      content: string;
      usage?: ProviderChatResult["usage"];
      finishReason?: string;
      delayMs?: number;
    }
  | { kind: "error"; message: string; delayMs?: number }
  // long delay that only resolves if not aborted — used for timeout tests
  | { kind: "hang"; delayMs: number };

export interface MockProviderOptions {
  id: string;
  type?: "local" | "cloud";
  /** Scripts keyed by upstream model name. A queue: each call shifts the next,
   * repeating the last once the queue has one entry left. */
  scripts?: Record<string, MockScript[]>;
  fallback?: MockScript;
  /** Pricing per 1M tokens; when set, estimateCost returns priced:true. */
  price?: { input: number; output: number };
  health?: HealthStatus;
  streamChunks?: string[];
}

const okFallback: MockScript = { kind: "ok", content: "mock response" };

export function ok(
  content: string,
  usage?: ProviderChatResult["usage"],
  delayMs?: number,
): MockScript {
  return { kind: "ok", content, usage, delayMs };
}
export function fail(message: string, delayMs?: number): MockScript {
  return { kind: "error", message, delayMs };
}
export function hang(delayMs: number): MockScript {
  return { kind: "hang", delayMs };
}

export class MockProvider implements Provider {
  readonly id: string;
  readonly name: string;
  readonly type: "local" | "cloud";
  private readonly scripts: Map<string, MockScript[]>;
  private readonly fallback: MockScript;
  private readonly price?: { input: number; output: number };
  private readonly healthStatus: HealthStatus;
  private readonly streamChunks?: string[];
  /** Records every model called, for assertions. */
  readonly calls: string[] = [];

  constructor(opts: MockProviderOptions) {
    this.id = opts.id;
    this.name = `Mock(${opts.id})`;
    this.type = opts.type ?? "cloud";
    this.scripts = new Map(Object.entries(opts.scripts ?? {}).map(([k, v]) => [k, [...v]]));
    this.fallback = opts.fallback ?? okFallback;
    this.price = opts.price;
    this.healthStatus = opts.health ?? { ok: true };
    this.streamChunks = opts.streamChunks;
  }

  private nextScript(model: string): MockScript {
    const queue = this.scripts.get(model);
    if (!queue || queue.length === 0) return this.fallback;
    return queue.length > 1 ? (queue.shift() as MockScript) : queue[0];
  }

  async chatCompletion(req: ProviderChatRequest): Promise<ProviderChatResult> {
    this.calls.push(req.model);
    const script = this.nextScript(req.model);
    await wait(scriptDelay(script), req.signal);
    if (script.kind === "error") {
      throw FusionError.provider(`${this.id}: ${script.message}`, { provider: this.id });
    }
    if (script.kind === "hang") {
      // Should never reach here: a hang only resolves if NOT aborted.
      return { content: "", finishReason: "stop", model: req.model };
    }
    return {
      content: script.content,
      finishReason: script.finishReason ?? "stop",
      usage: script.usage,
      model: req.model,
    };
  }

  async *chatCompletionStream(req: ProviderChatRequest): AsyncIterable<ProviderStreamChunk> {
    this.calls.push(req.model);
    const chunks = this.streamChunks ?? ["mock ", "stream"];
    for (const c of chunks) {
      await wait(0, req.signal);
      yield { delta: c };
    }
    yield {
      delta: "",
      finishReason: "stop",
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    return this.healthStatus;
  }

  estimateCost(tokens: TokenCounts, _model: string): CostEstimate {
    if (!this.price) return { usd: 0, priced: false };
    return {
      usd:
        (tokens.promptTokens / 1e6) * this.price.input +
        (tokens.completionTokens / 1e6) * this.price.output,
      priced: true,
    };
  }
}

function scriptDelay(s: MockScript): number {
  return s.kind === "hang" ? s.delayMs : (s.delayMs ?? 0);
}

/** Resolve after `ms`, or reject with the abort reason (TimeoutError) if aborted first. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
