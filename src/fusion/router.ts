import { type Clock, systemClock } from "../clock.js";
import type { AppConfig } from "../config/config.js";
import { FusionError } from "../errors.js";
import type { Logger } from "../observability/logger.js";
import type { ChatMessage, ModelRef, ProviderRegistry, Usage } from "../providers/base.js";
import {
  DEFAULT_COMPLETION_TOKENS,
  estimateFusionCost,
  estimatePromptTokens,
  estimateStageCost,
} from "./costEstimator.js";
import { CostTracker } from "./costTracker.js";
import { type RoutingDecision, decideMode } from "./heuristics.js";
import { runJudge } from "./judge.js";
import { runPanel } from "./panelRunner.js";
import { buildFusionPlan } from "./presets.js";
import type { PanelExcerpt } from "./prompts.js";
import { pickBestPanelAnswer, runSynth } from "./synthesizer.js";
import type {
  ConfidenceLevel,
  FailedModelInfo,
  FusionMetadata,
  FusionOptions,
  PanelResult,
  PresetName,
  ResolvedFusionPlan,
} from "./types.js";

export interface FusionRouterDeps {
  registry: ProviderRegistry;
  config: AppConfig;
  logger: Logger;
  clock?: Clock;
}

export interface FusionRunInput {
  /** Response model label (e.g. "fusion/quality" or a real model id). */
  model: string;
  messages: ChatMessage[];
  fusion: FusionOptions;
  preset: PresetName | null;
  temperature?: number;
  maxTokens?: number;
  requestId: string;
}

export interface FusionRunResult {
  content: string;
  usage: Usage;
  finishReason: string;
  model: string;
  metadata: FusionMetadata;
}

export class FusionRouter {
  private readonly registry: ProviderRegistry;
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly clock: Clock;

  constructor(deps: FusionRouterDeps) {
    this.registry = deps.registry;
    this.config = deps.config;
    this.logger = deps.logger;
    this.clock = deps.clock ?? systemClock;
  }

  async run(input: FusionRunInput): Promise<FusionRunResult> {
    const decision = decideMode(input.messages, input.fusion.mode);
    const plan = buildFusionPlan({
      preset: input.preset,
      fusion: input.fusion,
      config: this.config,
      messages: input.messages,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    });
    if (!decision.fusion) return this.singleFallback(plan, input, decision);
    return this.runPipeline(plan, input, decision);
  }

  /** auto-skip or mode=off: one call to the synthesizer (the designated writer). */
  private async singleFallback(
    plan: ResolvedFusionPlan,
    input: FusionRunInput,
    decision: RoutingDecision,
  ): Promise<FusionRunResult> {
    const single = await callSingleModel(this.registry, plan.synthesizer, {
      messages: input.messages,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    });
    return {
      content: single.content,
      usage: single.usage,
      finishReason: single.finishReason,
      model: input.model,
      metadata: buildMetadata({
        input,
        plan,
        decision,
        usedFusion: false,
        analysisModels: [],
        judgeModel: null,
        synthModel: single.model,
        failed: [],
        latency: {},
        costUsd: single.costUsd,
        allPriced: single.priced,
        confidence: null,
        judgeMeta: { repaired: false, fell_back: false },
      }),
    };
  }

  private async runPipeline(
    plan: ResolvedFusionPlan,
    input: FusionRunInput,
    decision: RoutingDecision,
  ): Promise<FusionRunResult> {
    // Each stage gets its own per-call timeout (timeoutMs); a generous pipeline
    // deadline bounds the sequential total (panel ∥, then judge, then synth).
    const pipelineDeadline = AbortSignal.timeout(plan.timeoutMs * 3);
    const tracker = new CostTracker();
    const basePromptTokens = estimatePromptTokens(plan.messages);

    // Resolve model names (also validates providers / URLs up front).
    const panelNames = plan.panel.map(
      (p) =>
        this.registry.resolve({ provider: p.provider, model: p.model, base_url: p.base_url }).model,
    );
    const judgeName = this.registry.resolve(plan.judge).model;
    const synthName = this.registry.resolve(plan.synthesizer).model;

    // ── Gate 1: preflight cost cap (blocks BEFORE any spend) ──
    if (plan.capUsd !== null) {
      const estimate = estimateFusionCost({
        basePromptTokens,
        panelModels: panelNames,
        judgeModel: judgeName,
        synthModel: synthName,
      });
      if (estimate.total > plan.capUsd) {
        throw FusionError.costCap(
          `estimated cost $${estimate.total.toFixed(4)} exceeds max_usd_per_request $${plan.capUsd.toFixed(4)}`,
          {
            estimated_usd: round(estimate.total),
            cap_usd: plan.capUsd,
            spent_usd: 0,
            stage: "preflight",
          },
        );
      }
    }

    // ── Panel (parallel, isolated) ──
    const panelResults = await runPanel({
      registry: this.registry,
      panel: plan.panel,
      messages: plan.messages,
      temperature: plan.temperature,
      maxTokens: plan.maxTokens,
      perModelTimeoutMs: plan.timeoutMs,
      globalSignal: pipelineDeadline,
      clock: this.clock,
    });

    const latency: Record<string, number> = {};
    const failed: FailedModelInfo[] = [];
    const successes: Array<Extract<PanelResult, { ok: true }>> = [];
    for (const r of panelResults) {
      latency[r.id] = r.latencyMs;
      if (r.ok) {
        successes.push(r);
        tracker.add({
          stage: `panel:${r.id}`,
          model: r.model,
          usd: r.costUsd,
          priced: r.priced,
          promptTokens: r.usage?.prompt_tokens ?? 0,
          completionTokens: r.usage?.completion_tokens ?? 0,
        });
      } else {
        failed.push({ id: r.id, reason: r.reason, message: r.message });
      }
    }

    if (successes.length === 0) {
      throw FusionError.allModelsFailed("all panel models failed", {
        failed_models: failed,
      });
    }

    const excerpts: PanelExcerpt[] = successes.map((s) => ({
      id: s.id,
      provider: s.provider,
      model: s.model,
      content: s.content,
    }));

    // Forward-spend estimates for the remaining stages.
    const estJudge = estimateStageCost(
      judgeName,
      basePromptTokens + successes.length * DEFAULT_COMPLETION_TOKENS.analysis + 300,
      DEFAULT_COMPLETION_TOKENS.judge,
    );
    const estSynth = estimateStageCost(
      synthName,
      basePromptTokens + DEFAULT_COMPLETION_TOKENS.judge + 200,
      DEFAULT_COMPLETION_TOKENS.synth,
    );

    // ── Gate 2: pre-judge (panel money already spent; decide forward only) ──
    if (tracker.wouldExceed(estJudge.usd + estSynth.usd, plan.capUsd)) {
      const best = pickBestPanelAnswer(excerpts);
      this.logger.warn("cost cap reached before judge; returning best panel answer", {
        requestId: input.requestId,
      });
      return {
        content: best?.content ?? "",
        usage: sumUsage(successes),
        finishReason: "stop",
        model: input.model,
        metadata: buildMetadata({
          input,
          plan,
          decision,
          usedFusion: true,
          analysisModels: plan.panel.map((p) => p.id),
          judgeModel: null,
          synthModel: null,
          failed,
          latency,
          costUsd: tracker.total(),
          allPriced: tracker.allPriced(),
          confidence: null,
          judgeMeta: { repaired: false, fell_back: false },
          stoppedAtStage: "judge",
        }),
      };
    }

    // ── Judge + repair ladder ──
    const judge = await runJudge({
      registry: this.registry,
      judge: plan.judge,
      messages: plan.messages,
      panel: excerpts,
      signal: stageSignal(plan.timeoutMs, pipelineDeadline),
      clock: this.clock,
    });
    tracker.add({
      stage: "judge",
      model: judge.model,
      usd: judge.costUsd,
      priced: judge.priced,
      promptTokens: judge.usage?.prompt_tokens ?? 0,
      completionTokens: judge.usage?.completion_tokens ?? 0,
    });
    latency.judge = judge.latencyMs;

    // ── Gate 3: pre-synth ──
    if (tracker.wouldExceed(estSynth.usd, plan.capUsd)) {
      const best = pickBestPanelAnswer(excerpts);
      this.logger.warn("cost cap reached before synthesis; returning best panel answer", {
        requestId: input.requestId,
      });
      return {
        content: best?.content ?? "",
        usage: sumUsage(successes, judge.usage),
        finishReason: "stop",
        model: input.model,
        metadata: buildMetadata({
          input,
          plan,
          decision,
          usedFusion: true,
          analysisModels: plan.panel.map((p) => p.id),
          judgeModel: judge.model,
          synthModel: null,
          failed,
          latency,
          costUsd: tracker.total(),
          allPriced: tracker.allPriced(),
          confidence: judge.analysis.confidence.overall,
          judgeMeta: { repaired: judge.repaired, fell_back: judge.fellBack },
          stoppedAtStage: "synth",
        }),
      };
    }

    // ── Synthesis (fall back to best panel answer if it fails) ──
    let content: string;
    let synthModel: string | null;
    let finishReason = "stop";
    let synthUsage: Usage | undefined;
    try {
      const synth = await runSynth({
        registry: this.registry,
        synthesizer: plan.synthesizer,
        messages: plan.messages,
        judge: judge.analysis,
        excerpts,
        temperature: plan.temperature,
        maxTokens: plan.maxTokens,
        signal: stageSignal(plan.timeoutMs, pipelineDeadline),
        clock: this.clock,
      });
      tracker.add({
        stage: "synth",
        model: synth.model,
        usd: synth.costUsd,
        priced: synth.priced,
        promptTokens: synth.usage?.prompt_tokens ?? 0,
        completionTokens: synth.usage?.completion_tokens ?? 0,
      });
      latency.synth = synth.latencyMs;
      content = synth.content;
      synthModel = synth.model;
      finishReason = synth.finishReason;
      synthUsage = synth.usage;
    } catch (err) {
      this.logger.warn("synthesizer failed; falling back to best panel answer", {
        requestId: input.requestId,
        error: (err as Error).message,
      });
      content = pickBestPanelAnswer(excerpts)?.content ?? "";
      synthModel = null;
    }

    return {
      content,
      usage: sumUsage(successes, judge.usage, synthUsage),
      finishReason,
      model: input.model,
      metadata: buildMetadata({
        input,
        plan,
        decision,
        usedFusion: true,
        analysisModels: plan.panel.map((p) => p.id),
        judgeModel: judge.model,
        synthModel,
        failed,
        latency,
        costUsd: tracker.total(),
        allPriced: tracker.allPriced(),
        confidence: judge.analysis.confidence.overall,
        judgeMeta: { repaired: judge.repaired, fell_back: judge.fellBack },
      }),
    };
  }
}

/** Single-model call shared by the chat route (plain models) and auto-skip. */
export async function callSingleModel(
  registry: ProviderRegistry,
  ref: ModelRef,
  args: { messages: ChatMessage[]; temperature?: number; maxTokens?: number; signal?: AbortSignal },
): Promise<{
  content: string;
  usage: Usage;
  finishReason: string;
  model: string;
  costUsd: number;
  priced: boolean;
}> {
  const { provider, model } = registry.resolve(ref);
  const res = await provider.chatCompletion({
    model,
    messages: args.messages,
    temperature: args.temperature,
    max_tokens: args.maxTokens,
    signal: args.signal,
  });
  const usage = res.usage ?? zeroUsage();
  const tokens = { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens };
  const cost = provider.estimateCost
    ? provider.estimateCost(tokens, model)
    : { usd: 0, priced: false };
  return {
    content: res.content,
    usage,
    finishReason: res.finishReason ?? "stop",
    model: res.model,
    costUsd: cost.usd,
    priced: cost.priced,
  };
}

interface MetaArgs {
  input: FusionRunInput;
  plan: ResolvedFusionPlan;
  decision: RoutingDecision;
  usedFusion: boolean;
  analysisModels: string[];
  judgeModel: string | null;
  synthModel: string | null;
  failed: FailedModelInfo[];
  latency: Record<string, number>;
  costUsd: number;
  allPriced: boolean;
  confidence: ConfidenceLevel | null;
  judgeMeta: { repaired: boolean; fell_back: boolean };
  stoppedAtStage?: string;
}

function buildMetadata(a: MetaArgs): FusionMetadata {
  const mode = a.usedFusion
    ? a.input.fusion.mode === "forced"
      ? "forced"
      : "auto"
    : a.input.fusion.mode;
  return {
    mode,
    requested_mode: a.input.fusion.mode,
    preset: a.plan.preset,
    used_fusion: a.usedFusion,
    routing_reason: a.decision.reason,
    analysis_models: a.analysisModels,
    judge_model: a.judgeModel,
    synthesizer_model: a.synthModel,
    failed_models: a.failed,
    latency_ms: a.latency,
    estimated_cost_usd: round(a.costUsd),
    confidence: a.confidence,
    cost: {
      tracked: a.plan.costTrack,
      cap_usd: a.plan.capUsd,
      priced: a.allPriced,
      ...(a.stoppedAtStage ? { stopped_at_stage: a.stoppedAtStage } : {}),
    },
    judge: a.judgeMeta,
  };
}

function sumUsage(panel: Array<{ usage?: Usage }>, ...rest: Array<Usage | undefined>): Usage {
  let p = 0;
  let c = 0;
  for (const s of panel) {
    p += s.usage?.prompt_tokens ?? 0;
    c += s.usage?.completion_tokens ?? 0;
  }
  for (const u of rest) {
    p += u?.prompt_tokens ?? 0;
    c += u?.completion_tokens ?? 0;
  }
  return { prompt_tokens: p, completion_tokens: c, total_tokens: p + c };
}

function zeroUsage(): Usage {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

/** Per-call timeout, combined with the overall pipeline deadline. */
function stageSignal(ms: number, deadline: AbortSignal): AbortSignal {
  return AbortSignal.any([AbortSignal.timeout(ms), deadline]);
}

function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}
