import { type Clock, systemClock } from "../clock.js";
import type { ChatMessage, Provider, ProviderRegistry, Usage } from "../providers/base.js";
import { deterministicRepair, tryParseJson } from "./jsonRepair.js";
import { type PanelExcerpt, buildJudgeMessages, buildRepairMessages } from "./prompts.js";
import { type JudgeAnalysis, JudgeAnalysisSchema, type ModelEndpointSpec } from "./types.js";

export interface JudgeOutcome {
  analysis: JudgeAnalysis;
  /** A repair was needed (repair call and/or deterministic repair). */
  repaired: boolean;
  /** All repair rungs failed; the structured fallback was used. */
  fellBack: boolean;
  model: string;
  costUsd: number;
  priced: boolean;
  usage?: Usage;
  latencyMs: number;
}

export interface RunJudgeOptions {
  registry: ProviderRegistry;
  judge: ModelEndpointSpec;
  messages: ChatMessage[];
  panel: PanelExcerpt[];
  temperature?: number;
  signal?: AbortSignal;
  clock?: Clock;
}

/**
 * Judge call + the 4-rung repair ladder (guardrail G6):
 *   1. parse (strip fences) → Zod-validate     (valid JSON ≠ valid shape)
 *   2. exactly ONE repair call → parse+validate
 *   3. deterministic jsonRepair → validate
 *   4. synthesis-shaped fallback object
 * The fallback's recommended_answer_plan tells the synthesizer to work from the
 * raw panel answers, so a degraded judge still yields a usable answer.
 */
export async function runJudge(opts: RunJudgeOptions): Promise<JudgeOutcome> {
  const clock = opts.clock ?? systemClock;
  const start = clock();
  const { provider, model } = opts.registry.resolve(opts.judge);
  let costUsd = 0;
  let priced = true;
  let usage: Usage | undefined;

  // ── Judge call ──
  let raw: string;
  try {
    const res = await provider.chatCompletion({
      model,
      messages: buildJudgeMessages(opts.messages, opts.panel),
      temperature: opts.temperature,
      signal: opts.signal,
    });
    raw = res.content;
    usage = res.usage;
    const c = costOf(provider, res.usage, model);
    costUsd += c.usd;
    priced = priced && c.priced;
  } catch {
    // Judge unreachable → fallback so the synthesizer can still run.
    return done(fallbackAnalysis(opts.panel), false, true);
  }

  // Rung 1: parse + validate
  const direct = validate(tryParseJson(raw));
  if (direct) return done(direct, false, false);

  // Rung 2: one repair call
  let repaired = false;
  try {
    const rep = await provider.chatCompletion({
      model,
      messages: buildRepairMessages(raw),
      temperature: 0,
      signal: opts.signal,
    });
    repaired = true;
    const c = costOf(provider, rep.usage, model);
    costUsd += c.usd;
    priced = priced && c.priced;
    const fixed = validate(tryParseJson(rep.content) ?? deterministicRepair(rep.content));
    if (fixed) return done(fixed, true, false);
  } catch {
    repaired = true; // attempted
  }

  // Rung 3: deterministic repair on the original output
  const det = validate(deterministicRepair(raw));
  if (det) return done(det, true, false);

  // Rung 4: structured fallback
  return done(fallbackAnalysis(opts.panel), repaired, true);

  function done(analysis: JudgeAnalysis, wasRepaired: boolean, fellBack: boolean): JudgeOutcome {
    return {
      analysis,
      repaired: wasRepaired,
      fellBack,
      model,
      costUsd,
      priced,
      usage,
      latencyMs: clock() - start,
    };
  }
}

function validate(value: unknown | null): JudgeAnalysis | null {
  if (value == null) return null;
  const r = JudgeAnalysisSchema.safeParse(value);
  return r.success ? r.data : null;
}

/** Synthesis-shaped fallback: instructs the synthesizer to use raw panel output. */
export function fallbackAnalysis(panel: PanelExcerpt[]): JudgeAnalysis {
  return {
    consensus: [],
    contradictions: [],
    partial_coverage: [],
    unique_insights: [],
    blind_spots: [],
    likely_errors: [],
    recommended_answer_plan: [
      "Judge analysis is unavailable. Synthesize the answer directly from the panel responses below, weighting longer and more specific answers and explicitly noting where the panel disagrees.",
    ],
    confidence: { overall: "low", notes: "Judge output could not be parsed; confidence reduced." },
    model_scores: panel.map((p) => ({ model_id: p.id, strengths: [], weaknesses: [], score: 0 })),
    _fallback: true,
  };
}

function costOf(
  provider: Provider,
  usage: Usage | undefined,
  model: string,
): { usd: number; priced: boolean } {
  const tokens = {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
  };
  return provider.estimateCost ? provider.estimateCost(tokens, model) : { usd: 0, priced: false };
}
