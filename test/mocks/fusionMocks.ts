import { MockProvider, type MockScript, ok } from "./mockProvider.js";

export const VALID_JUDGE = JSON.stringify({
  consensus: ["both identify single point of failure X"],
  contradictions: [],
  partial_coverage: ["scaling under load"],
  unique_insights: ["cache-stampede edge case Y"],
  blind_spots: [],
  likely_errors: [],
  recommended_answer_plan: ["address risk X with redundancy", "handle edge case Y with jitter"],
  confidence: { overall: "high", notes: "strong agreement" },
  model_scores: [
    { model_id: "panel-a", strengths: ["clear"], weaknesses: [], score: 8 },
    { model_id: "panel-b", strengths: ["thorough"], weaknesses: ["verbose"], score: 7 },
  ],
});

export const SYNTH_ANSWER = "Final answer: mitigate X with redundancy and handle Y with jitter.";

const USAGE = { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 };

/** A single mock provider that plays panel, judge, and synthesizer by model id. */
export function fusionProvider(
  judgeScripts: MockScript[] = [ok(VALID_JUDGE, USAGE)],
): MockProvider {
  return new MockProvider({
    id: "mock",
    type: "cloud",
    price: { input: 1, output: 2 },
    scripts: {
      panelA: [ok("Panel A: the architecture risks single point of failure X.", USAGE)],
      panelB: [ok("Panel B: also consider the cache-stampede edge case Y.", USAGE)],
      judge: judgeScripts,
      synth: [ok(SYNTH_ANSWER, USAGE)],
    },
  });
}

export interface FusionBodyOpts {
  model?: string;
  mode?: string;
  content?: string;
  cost?: { track: boolean; max_usd_per_request: number | null };
  panelModelNames?: [string, string];
}

export function fusionBody(opts: FusionBodyOpts = {}): Record<string, unknown> {
  const [pa, pb] = opts.panelModelNames ?? ["panelA", "panelB"];
  return {
    model: opts.model ?? "fusion/custom",
    messages: [
      {
        role: "user",
        content: opts.content ?? "Audit this architecture for failure modes and find flaws",
      },
    ],
    fusion: {
      mode: opts.mode ?? "forced",
      analysis_models: [
        { id: "panel-a", provider: "mock", model: pa },
        { id: "panel-b", provider: "mock", model: pb },
      ],
      judge: { provider: "mock", model: "judge" },
      synthesizer: { provider: "mock", model: "synth" },
      ...(opts.cost ? { cost: opts.cost } : {}),
    },
  };
}
