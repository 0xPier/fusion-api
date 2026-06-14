import { z } from "zod";
import type { ChatMessage, Usage } from "../providers/base.js";

// ─────────────────────────────────────────────────────────────
// Fusion request shape (the `fusion` object on an OpenAI request)
// ─────────────────────────────────────────────────────────────

export type FusionMode = "auto" | "forced" | "off";
export type PresetName = "quality" | "budget" | "local-heavy" | "cloud-heavy" | "custom";

export const PRESET_NAMES: readonly PresetName[] = [
  "quality",
  "budget",
  "local-heavy",
  "cloud-heavy",
  "custom",
] as const;

/** Virtual model ids surfaced by GET /v1/models. */
export const VIRTUAL_FUSION_MODELS: readonly string[] = PRESET_NAMES.map((p) => `fusion/${p}`);

/** A panel model: `id` is the metadata label; provider+model+base_url is how to call it. */
export interface PanelModelSpec {
  id?: string;
  provider: string;
  model: string;
  base_url?: string;
}

/** A panel model after plan resolution — `id` is always present. */
export interface ResolvedPanelModel {
  id: string;
  provider: string;
  model: string;
  base_url?: string;
}

/** Judge / synthesizer endpoint spec. */
export interface ModelEndpointSpec {
  provider: string;
  model: string;
  base_url?: string;
}

export interface FusionCostOptions {
  track: boolean;
  max_usd_per_request: number | null;
}

export interface FusionOptions {
  mode: FusionMode;
  preset?: PresetName;
  analysis_models?: PanelModelSpec[];
  judge?: ModelEndpointSpec;
  synthesizer?: ModelEndpointSpec;
  max_panel_models?: number;
  timeout_ms?: number;
  web?: { enabled: boolean };
  cost?: FusionCostOptions;
}

// ─────────────────────────────────────────────────────────────
// Judge analysis — the strict structured contract (guardrail G6)
// ─────────────────────────────────────────────────────────────

export const ConfidenceLevelSchema = z.enum(["low", "medium", "high"]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

/** Map a number (0..1 or 0..100) or loose string onto the canonical enum. */
export function normalizeConfidence(v: unknown): ConfidenceLevel {
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "low" || s === "medium" || s === "high") return s;
    const n = Number(s);
    if (!Number.isNaN(n)) return numberToConfidence(n);
    return "medium";
  }
  if (typeof v === "number") return numberToConfidence(v);
  return "medium";
}

function numberToConfidence(n: number): ConfidenceLevel {
  const x = n > 1 ? n / 100 : n;
  if (x < 0.34) return "low";
  if (x < 0.67) return "medium";
  return "high";
}

export const ModelScoreSchema = z.object({
  model_id: z.string().default(""),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  score: z.coerce.number().default(0),
});

/**
 * Lenient on input, strict on output. Missing arrays default to [], the plan
 * accepts a string or array, confidence accepts an enum or a number — but the
 * parsed value always has the canonical spec shape so the synthesizer can rely
 * on it.
 */
export const JudgeAnalysisSchema = z.object({
  consensus: z.array(z.string()).default([]),
  contradictions: z.array(z.string()).default([]),
  partial_coverage: z.array(z.string()).default([]),
  unique_insights: z.array(z.string()).default([]),
  blind_spots: z.array(z.string()).default([]),
  likely_errors: z.array(z.string()).default([]),
  recommended_answer_plan: z.preprocess(
    (v) => (typeof v === "string" ? [v] : v),
    z.array(z.string()).default([]),
  ),
  confidence: z
    .object({
      overall: z.preprocess((v) => normalizeConfidence(v), ConfidenceLevelSchema),
      notes: z.string().default(""),
    })
    .default({ overall: "medium", notes: "" }),
  model_scores: z.array(ModelScoreSchema).default([]),
  _fallback: z.boolean().optional(),
});

export type JudgeAnalysis = z.infer<typeof JudgeAnalysisSchema>;

// ─────────────────────────────────────────────────────────────
// Pipeline results + response metadata
// ─────────────────────────────────────────────────────────────

export type PanelFailureReason = "timeout" | "error" | "empty";

export type PanelResult =
  | {
      ok: true;
      id: string;
      provider: string;
      model: string;
      content: string;
      usage?: Usage;
      costUsd: number;
      priced: boolean;
      latencyMs: number;
    }
  | {
      ok: false;
      id: string;
      provider: string;
      model: string;
      reason: PanelFailureReason;
      message: string;
      latencyMs: number;
    };

export interface FailedModelInfo {
  id: string;
  reason: PanelFailureReason;
  message: string;
}

export interface FusionMetadata {
  mode: FusionMode;
  requested_mode: FusionMode;
  preset: PresetName | null;
  used_fusion: boolean;
  routing_reason?: string;
  analysis_models: string[];
  judge_model: string | null;
  synthesizer_model: string | null;
  failed_models: FailedModelInfo[];
  latency_ms: Record<string, number>;
  estimated_cost_usd: number;
  confidence: ConfidenceLevel | null;
  cost: {
    tracked: boolean;
    cap_usd: number | null;
    priced: boolean;
    stopped_at_stage?: string;
  };
  judge: {
    repaired: boolean;
    fell_back: boolean;
  };
}

/** Normalized fusion request after preset + defaults are applied. */
export interface ResolvedFusionPlan {
  preset: PresetName | null;
  panel: ResolvedPanelModel[];
  judge: ModelEndpointSpec;
  synthesizer: ModelEndpointSpec;
  timeoutMs: number;
  costTrack: boolean;
  capUsd: number | null;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}
