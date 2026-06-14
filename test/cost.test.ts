import { describe, expect, it } from "vitest";
import { estimateFusionCost, estimatePromptTokens } from "../src/fusion/costEstimator.js";
import { CostTracker } from "../src/fusion/costTracker.js";

describe("costEstimator", () => {
  it("estimates prompt tokens as ~chars/4", () => {
    const t = estimatePromptTokens([{ role: "user", content: "x".repeat(400) }]);
    expect(t).toBeGreaterThanOrEqual(100);
    expect(t).toBeLessThan(120);
  });

  it("estimates a priced cloud fusion run with cost > 0", () => {
    const est = estimateFusionCost({
      basePromptTokens: 500,
      panelModels: ["openai/gpt-4o", "anthropic/claude-sonnet-4.5"],
      judgeModel: "openai/gpt-4o",
      synthModel: "openai/gpt-4o",
    });
    expect(est.total).toBeGreaterThan(0);
    expect(est.priced).toBe(true);
    expect(est.stages).toHaveLength(4); // 2 panel + judge + synth
  });

  it("treats unknown/local models as unpriced (cost 0, priced:false)", () => {
    const est = estimateFusionCost({
      basePromptTokens: 500,
      panelModels: ["qwen3", "llama3.1"],
      judgeModel: "qwen3",
      synthModel: "qwen3",
    });
    expect(est.total).toBe(0);
    expect(est.priced).toBe(false);
  });
});

describe("CostTracker", () => {
  it("accumulates and gates forward spend", () => {
    const t = new CostTracker();
    t.add({
      stage: "panel[0]",
      model: "gpt-4o",
      usd: 0.01,
      priced: true,
      promptTokens: 100,
      completionTokens: 100,
    });
    t.add({
      stage: "panel[1]",
      model: "gpt-4o",
      usd: 0.02,
      priced: true,
      promptTokens: 100,
      completionTokens: 100,
    });
    expect(t.total()).toBeCloseTo(0.03, 6);
    expect(t.wouldExceed(0.01, 0.05)).toBe(false); // 0.03 + 0.01 <= 0.05
    expect(t.wouldExceed(0.05, 0.05)).toBe(true); // 0.03 + 0.05 > 0.05
    expect(t.wouldExceed(999, null)).toBe(false); // no cap
    expect(t.allPriced()).toBe(true);
  });

  it("flags unpriced entries", () => {
    const t = new CostTracker();
    t.add({
      stage: "panel[0]",
      model: "qwen3",
      usd: 0,
      priced: false,
      promptTokens: 100,
      completionTokens: 100,
    });
    expect(t.anyUnpriced()).toBe(true);
    expect(t.allPriced()).toBe(false);
  });
});
