import type { Context } from "hono";
import { ChatCompletionRequestSchema, EstimateCostRequestSchema } from "../../config/schema.js";
import { estimateFusionCost, estimatePromptTokens } from "../../fusion/costEstimator.js";
import { buildFusionPlan, listPresets } from "../../fusion/presets.js";
import type { FusionOptions } from "../../fusion/types.js";
import type { ModelRef, ProviderRegistry } from "../../providers/base.js";
import type { AppEnv, RouteDeps } from "../types.js";
import { readJsonBody, validateBody } from "../validation.js";
import { handleCompletion, parseModelRef, presetFromModel } from "./chat.js";

/** POST /v1/fusion/completions — always fusion unless fusion.mode === "off". */
export function createFusionCompletionsHandler(deps: RouteDeps) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const req = validateBody(ChatCompletionRequestSchema, await readJsonBody(c));
    return handleCompletion(deps, c, req, true);
  };
}

/** GET /v1/fusion/presets — preset catalog with cost/quality intent. */
export function createPresetsHandler(_deps: RouteDeps) {
  return (c: Context<AppEnv>): Response => c.json({ object: "list", data: listPresets() });
}

/** POST /v1/fusion/estimate-cost — preflight estimate without calling any model. */
export function createEstimateCostHandler(deps: RouteDeps) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const req = validateBody(EstimateCostRequestSchema, await readJsonBody(c));
    const preset =
      req.fusion?.preset ?? presetFromModel(req.model) ?? deps.config.fusion.defaultPreset;
    const fusion: FusionOptions = { ...(req.fusion ?? {}), mode: "forced" };
    const plan = buildFusionPlan({
      preset,
      fusion,
      config: deps.config,
      messages: req.messages,
    });

    const basePromptTokens = estimatePromptTokens(req.messages);
    const panelModels = plan.panel.map((p) =>
      resolveModelName(deps.registry, {
        provider: p.provider,
        model: p.model,
        base_url: p.base_url,
      }),
    );
    const estimate = estimateFusionCost({
      basePromptTokens,
      panelModels,
      judgeModel: resolveModelName(deps.registry, plan.judge),
      synthModel: resolveModelName(deps.registry, plan.synthesizer),
    });

    return c.json({
      preset,
      estimated_cost_usd: Math.round(estimate.total * 1e6) / 1e6,
      priced: estimate.priced,
      cap_usd: plan.capUsd,
      within_cap: plan.capUsd === null ? true : estimate.total <= plan.capUsd,
      stages: estimate.stages,
      note: "Estimate only (chars/4 tokens, default completion sizes). Not billing truth; unpriced models count as $0.",
    });
  };
}

/** Resolve a ref to its upstream model name; fall back to the raw name if the
 * provider isn't configured (so cost can be estimated without credentials). */
function resolveModelName(registry: ProviderRegistry, ref: ModelRef): string {
  try {
    return registry.resolve(ref).model;
  } catch {
    return ref.model;
  }
}
