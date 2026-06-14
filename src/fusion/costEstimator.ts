import type { ChatMessage } from "../providers/base.js";
import { estimateCostUsd } from "../providers/pricing.js";

/**
 * PURE preflight cost estimation (guardrail G3). Token count is approximated as
 * ceil(chars/4) — loose for code/CJK, fine as a conservative guardrail; it is
 * NEVER treated as billing truth. Default completion sizes are constants so
 * tests can pin them.
 */
export const DEFAULT_COMPLETION_TOKENS = {
  analysis: 800,
  judge: 1200,
  synth: 1500,
} as const;

const PANEL_SYSTEM_TOKENS = 150;
const JUDGE_SYSTEM_TOKENS = 300;
const SYNTH_SYSTEM_TOKENS = 200;
const EXCERPT_TOKENS_PER_MODEL = 200;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimatePromptTokens(messages: ChatMessage[]): number {
  const chars = messages.reduce((n, m) => n + m.content.length + m.role.length + 4, 0);
  return Math.ceil(chars / 4);
}

export interface StageEstimate {
  stage: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  usd: number;
  priced: boolean;
}

export interface FusionCostEstimate {
  total: number;
  /** false if ANY model lacked pricing data (cost is a lower bound). */
  priced: boolean;
  stages: StageEstimate[];
}

export interface FusionEstimateInput {
  basePromptTokens: number;
  panelModels: string[];
  judgeModel: string;
  synthModel: string;
}

/**
 * Estimate the full additive fusion cost: N panel calls + judge + synth.
 * Judge sees the base prompt plus every panel output; synth sees the base
 * prompt plus the judge output plus excerpts. Approximations, deterministic.
 */
export function estimateFusionCost(input: FusionEstimateInput): FusionCostEstimate {
  const { basePromptTokens, panelModels, judgeModel, synthModel } = input;
  const stages: StageEstimate[] = [];

  for (let i = 0; i < panelModels.length; i++) {
    const model = panelModels[i];
    const promptTokens = basePromptTokens + PANEL_SYSTEM_TOKENS;
    const completionTokens = DEFAULT_COMPLETION_TOKENS.analysis;
    const { usd, priced } = estimateCostUsd({ promptTokens, completionTokens }, model);
    stages.push({ stage: `panel[${i}]`, model, promptTokens, completionTokens, usd, priced });
  }

  const panelOutputTokens = panelModels.length * DEFAULT_COMPLETION_TOKENS.analysis;
  const judgePrompt = basePromptTokens + panelOutputTokens + JUDGE_SYSTEM_TOKENS;
  const judgeEst = estimateCostUsd(
    { promptTokens: judgePrompt, completionTokens: DEFAULT_COMPLETION_TOKENS.judge },
    judgeModel,
  );
  stages.push({
    stage: "judge",
    model: judgeModel,
    promptTokens: judgePrompt,
    completionTokens: DEFAULT_COMPLETION_TOKENS.judge,
    usd: judgeEst.usd,
    priced: judgeEst.priced,
  });

  const synthPrompt =
    basePromptTokens +
    DEFAULT_COMPLETION_TOKENS.judge +
    panelModels.length * EXCERPT_TOKENS_PER_MODEL +
    SYNTH_SYSTEM_TOKENS;
  const synthEst = estimateCostUsd(
    { promptTokens: synthPrompt, completionTokens: DEFAULT_COMPLETION_TOKENS.synth },
    synthModel,
  );
  stages.push({
    stage: "synth",
    model: synthModel,
    promptTokens: synthPrompt,
    completionTokens: DEFAULT_COMPLETION_TOKENS.synth,
    usd: synthEst.usd,
    priced: synthEst.priced,
  });

  return {
    total: stages.reduce((sum, s) => sum + s.usd, 0),
    priced: stages.every((s) => s.priced),
    stages,
  };
}

/** Estimate one stage's cost (used for mid-pipeline forward-spend gates). */
export function estimateStageCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): { usd: number; priced: boolean } {
  return estimateCostUsd({ promptTokens, completionTokens }, model);
}
