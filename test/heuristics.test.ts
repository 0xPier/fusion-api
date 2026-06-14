import { describe, expect, it } from "vitest";
import { decideMode } from "../src/fusion/heuristics.js";
import type { ChatMessage } from "../src/providers/base.js";
import { HEURISTIC_FIXTURES } from "./fixtures/heuristics.js";

const user = (content: string): ChatMessage[] => [{ role: "user", content }];

describe("decideMode — explicit modes short-circuit", () => {
  it("forced always fuses", () => {
    expect(decideMode(user("hi"), "forced").fusion).toBe(true);
  });
  it("off never fuses", () => {
    expect(decideMode(user("Audit this architecture"), "off").fusion).toBe(false);
  });
});

describe("decideMode — auto fixtures", () => {
  for (const { prompt, fusion, note } of HEURISTIC_FIXTURES) {
    it(`${fusion ? "fuses" : "skips"}: ${note}`, () => {
      const decision = decideMode(user(prompt), "auto");
      expect(decision.fusion, `prompt: ${prompt} → ${decision.reason}`).toBe(fusion);
    });
  }

  it("returns matched signals for explainability", () => {
    const d = decideMode(user("Audit this architecture for failure modes"), "auto");
    expect(d.matched).toContain("audit");
    expect(d.matched).toContain("architecture");
    expect(d.reason).toMatch(/high-stakes/);
  });

  it("does not trip on 'fix' when the task is a grammar fix", () => {
    const d = decideMode(user("just fix the grammar here"), "auto");
    expect(d.fusion).toBe(false);
    expect(d.suppressed).toContain("grammar");
  });
});
