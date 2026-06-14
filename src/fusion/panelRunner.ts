import { type Clock, systemClock } from "../clock.js";
import type { ChatMessage, ProviderRegistry } from "../providers/base.js";
import { buildPanelMessages } from "./prompts.js";
import type { PanelResult, ResolvedPanelModel } from "./types.js";

export interface PanelRunOptions {
  registry: ProviderRegistry;
  panel: ResolvedPanelModel[];
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  perModelTimeoutMs: number;
  /** Global fusion deadline — aborts every in-flight call when the whole
   * pipeline runs out of time. Defaults to a never-aborting signal. */
  globalSignal?: AbortSignal;
  clock?: Clock;
}

/**
 * Run the panel in parallel with per-model timeout isolation (guardrail G5).
 * Uses Promise.allSettled + AbortSignal.any([perModelTimeout, globalDeadline]),
 * so one slow or failing model never aborts the others. Latency is recorded on
 * BOTH success and failure paths (a timed-out model reports ≈ perModelTimeoutMs).
 */
export async function runPanel(opts: PanelRunOptions): Promise<PanelResult[]> {
  const clock = opts.clock ?? systemClock;
  const panelMessages = buildPanelMessages(opts.messages);
  const settled = await Promise.allSettled(
    opts.panel.map((m) => runOne(m, panelMessages, opts, clock)),
  );
  return settled.map((r, i) =>
    r.status === "fulfilled" ? r.value : failure(opts.panel[i], r.reason, 0),
  );
}

async function runOne(
  m: ResolvedPanelModel,
  panelMessages: ChatMessage[],
  opts: PanelRunOptions,
  clock: Clock,
): Promise<PanelResult> {
  const start = clock();
  const signals: AbortSignal[] = [AbortSignal.timeout(opts.perModelTimeoutMs)];
  if (opts.globalSignal) signals.push(opts.globalSignal);
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

  try {
    const { provider, model } = opts.registry.resolve({
      provider: m.provider,
      model: m.model,
      base_url: m.base_url,
    });
    const res = await provider.chatCompletion({
      model,
      messages: panelMessages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      signal,
    });
    const latencyMs = clock() - start;

    if (!res.content || res.content.trim() === "") {
      return {
        ok: false,
        id: m.id,
        provider: m.provider,
        model: m.model,
        reason: "empty",
        message: "empty response",
        latencyMs,
      };
    }

    const tokens = {
      promptTokens: res.usage?.prompt_tokens ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
    };
    const cost = provider.estimateCost
      ? provider.estimateCost(tokens, model)
      : { usd: 0, priced: false };

    return {
      ok: true,
      id: m.id,
      provider: m.provider,
      model: m.model,
      content: res.content,
      usage: res.usage,
      costUsd: cost.usd,
      priced: cost.priced,
      latencyMs,
    };
  } catch (err) {
    return failure(m, err, clock() - start);
  }
}

function failure(m: ResolvedPanelModel, err: unknown, latencyMs: number): PanelResult {
  const name = err instanceof Error ? err.name : "";
  const reason = name === "TimeoutError" ? "timeout" : "error";
  const message =
    reason === "timeout"
      ? `timed out after ~${latencyMs}ms`
      : err instanceof Error
        ? err.message
        : String(err);
  return { ok: false, id: m.id, provider: m.provider, model: m.model, reason, message, latencyMs };
}
