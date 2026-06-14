import { type Clock, systemClock } from "../clock.js";
import type { ChatMessage, Provider, ProviderRegistry, Usage } from "../providers/base.js";
import { type PanelExcerpt, buildSynthMessages } from "./prompts.js";
import type { JudgeAnalysis, ModelEndpointSpec } from "./types.js";

export interface SynthOutcome {
  content: string;
  finishReason: string;
  model: string;
  costUsd: number;
  priced: boolean;
  usage?: Usage;
  latencyMs: number;
}

export interface RunSynthOptions {
  registry: ProviderRegistry;
  synthesizer: ModelEndpointSpec;
  messages: ChatMessage[];
  judge: JudgeAnalysis;
  excerpts: PanelExcerpt[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  clock?: Clock;
}

/** Final user-facing answer (guardrail G4: never exposes raw deliberation). */
export async function runSynth(opts: RunSynthOptions): Promise<SynthOutcome> {
  const clock = opts.clock ?? systemClock;
  const start = clock();
  const { provider, model } = opts.registry.resolve(opts.synthesizer);
  const res = await provider.chatCompletion({
    model,
    messages: buildSynthMessages(opts.messages, opts.judge, opts.excerpts),
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
    signal: opts.signal,
  });
  const tokens = {
    promptTokens: res.usage?.prompt_tokens ?? 0,
    completionTokens: res.usage?.completion_tokens ?? 0,
  };
  const cost = provider.estimateCost
    ? provider.estimateCost(tokens, model)
    : { usd: 0, priced: false };
  return {
    content: res.content,
    finishReason: res.finishReason ?? "stop",
    model,
    costUsd: cost.usd,
    priced: cost.priced,
    usage: res.usage,
    latencyMs: clock() - start,
  };
}

function pickBestPanelAnswer(excerpts: PanelExcerpt[]): PanelExcerpt | undefined {
  return [...excerpts].sort((a, b) => b.content.length - a.content.length)[0];
}

export { pickBestPanelAnswer };
