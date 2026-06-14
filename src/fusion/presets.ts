import type { AppConfig, PresetOverride } from "../config/config.js";
import { FusionError } from "../errors.js";
import type { ChatMessage } from "../providers/base.js";
import type {
  FusionOptions,
  ModelEndpointSpec,
  PanelModelSpec,
  PresetName,
  ResolvedFusionPlan,
  ResolvedPanelModel,
} from "./types.js";

export interface PresetDefinition {
  description: string;
  /** One-line cost/quality intent for FREE-zone tuners. */
  valueNote: string;
  analysis_models: ModelEndpointSpec[];
  judge: ModelEndpointSpec;
  synthesizer: ModelEndpointSpec;
}

const or = (model: string): ModelEndpointSpec => ({ provider: "openrouter", model });
const at = (provider: string, model: string): ModelEndpointSpec => ({ provider, model });

/**
 * Built-in preset defaults. Preset NAMES are locked (guardrail G1 virtual ids);
 * these contents are FREE to tune. The aggregator (judge/synth) stays capable
 * even in cheap tiers — that is the quality bottleneck.
 */
export const PRESETS: Record<Exclude<PresetName, "custom">, PresetDefinition> = {
  quality: {
    description: "Strongest cloud models; correctness dominates.",
    valueNote: "Highest quality, highest cost — NOT the cost-saver.",
    analysis_models: [
      or("anthropic/claude-sonnet-4.5"),
      or("openai/gpt-4o"),
      or("google/gemini-2.5-pro"),
    ],
    judge: or("anthropic/claude-sonnet-4.5"),
    synthesizer: or("anthropic/claude-sonnet-4.5"),
  },
  "cloud-heavy": {
    description: "Mostly strong cloud models; best for hard research/audits.",
    valueNote: "Breadth of strong models; high cost.",
    analysis_models: [
      or("anthropic/claude-opus-4.1"),
      or("openai/gpt-4.1"),
      or("google/gemini-2.5-pro"),
      or("anthropic/claude-sonnet-4.5"),
    ],
    judge: or("anthropic/claude-opus-4.1"),
    synthesizer: or("anthropic/claude-sonnet-4.5"),
  },
  budget: {
    description: "One cheap cloud model + one local model; capable aggregator.",
    valueNote: "The cost-saver: near-frontier on target tasks for ~cents.",
    analysis_models: [or("openai/gpt-4o-mini"), at("ollama", "qwen3")],
    judge: or("openai/gpt-4o-mini"),
    synthesizer: or("openai/gpt-4o-mini"),
  },
  "local-heavy": {
    description: "Mostly local ($0) models; aggregator may be local or cloud.",
    valueNote: "Cheapest: free panel; aggregator quality carries the answer.",
    analysis_models: [
      at("ollama", "qwen3"),
      at("ollama", "llama3.1"),
      at("lmstudio", "llama-3.1-8b-instruct"),
    ],
    judge: at("ollama", "qwen3"),
    synthesizer: at("ollama", "qwen3"),
  },
};

export interface PresetSummary {
  id: string;
  preset: PresetName;
  description: string;
  value_note: string;
  default_panel_size: number | null;
}

export function listPresets(): PresetSummary[] {
  const summaries: PresetSummary[] = (
    Object.keys(PRESETS) as Array<Exclude<PresetName, "custom">>
  ).map((p) => ({
    id: `fusion/${p}`,
    preset: p,
    description: PRESETS[p].description,
    value_note: PRESETS[p].valueNote,
    default_panel_size: PRESETS[p].analysis_models.length,
  }));
  summaries.push({
    id: "fusion/custom",
    preset: "custom",
    description: "Entirely caller-specified panel, judge, and synthesizer.",
    value_note: "You define the cost/quality tradeoff.",
    default_panel_size: null,
  });
  return summaries;
}

export interface BuildPlanArgs {
  preset: PresetName | null;
  fusion: FusionOptions;
  config: AppConfig;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * Resolve panel/judge/synth/timeout/cost from request > config override >
 * built-in preset > app default. The env cap is a hard ceiling: a request cap
 * can only tighten it, never raise it.
 */
export function buildFusionPlan(args: BuildPlanArgs): ResolvedFusionPlan {
  const { preset, fusion, config, messages } = args;
  const builtin = preset && preset !== "custom" ? PRESETS[preset] : null;
  const override: PresetOverride | undefined = preset ? config.presets[preset] : undefined;

  const panelSource: PanelModelSpec[] | undefined =
    fusion.analysis_models ??
    (override?.analysis_models ? override.analysis_models.map(normalizePanelEntry) : undefined) ??
    builtin?.analysis_models.map(toPanelSpec);

  if (!panelSource || panelSource.length === 0) {
    throw FusionError.validation(
      preset === "custom"
        ? "fusion preset 'custom' requires fusion.analysis_models (and judge/synthesizer)."
        : `no analysis models available for preset '${preset ?? "(none)"}'.`,
    );
  }

  const maxPanel = Math.min(fusion.max_panel_models ?? config.fusion.maxPanelModels, 8);
  const panel: ResolvedPanelModel[] = panelSource.slice(0, maxPanel).map(withId);

  const judge =
    fusion.judge ?? override?.judge ?? builtin?.judge ?? requireEndpoint(preset, "judge");
  const synthesizer =
    fusion.synthesizer ??
    override?.synthesizer ??
    builtin?.synthesizer ??
    requireEndpoint(preset, "synthesizer");

  return {
    preset,
    panel,
    judge,
    synthesizer,
    timeoutMs: fusion.timeout_ms ?? config.fusion.timeoutMs,
    costTrack: fusion.cost?.track ?? true,
    capUsd: resolveCap(fusion.cost?.max_usd_per_request ?? null, config.fusion.maxUsdPerRequest),
    messages,
    temperature: args.temperature,
    maxTokens: args.maxTokens,
  };
}

function toPanelSpec(e: ModelEndpointSpec): PanelModelSpec {
  return {
    id: `${e.provider}:${e.model}`,
    provider: e.provider,
    model: e.model,
    base_url: e.base_url,
  };
}

function normalizePanelEntry(
  e: string | { id?: string; provider: string; model: string; base_url?: string },
): PanelModelSpec {
  if (typeof e === "string") return { id: e, provider: e, model: e };
  return {
    id: e.id ?? `${e.provider}:${e.model}`,
    provider: e.provider,
    model: e.model,
    base_url: e.base_url,
  };
}

function withId(p: PanelModelSpec): ResolvedPanelModel {
  return {
    id: p.id ?? `${p.provider}:${p.model}`,
    provider: p.provider,
    model: p.model,
    base_url: p.base_url,
  };
}

function requireEndpoint(preset: PresetName | null, role: "judge" | "synthesizer"): never {
  throw FusionError.validation(
    `fusion preset '${preset ?? "(none)"}' requires a ${role} (set fusion.${role} or use a built-in preset).`,
  );
}

function resolveCap(requestCap: number | null, envCap: number | null): number | null {
  const caps = [requestCap, envCap].filter((c): c is number => c !== null);
  return caps.length > 0 ? Math.min(...caps) : null;
}
