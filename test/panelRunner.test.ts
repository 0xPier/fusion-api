import { describe, expect, it } from "vitest";
import { runPanel } from "../src/fusion/panelRunner.js";
import { makeMockRegistry } from "./mocks/makeRegistry.js";
import { MockProvider, hang, ok } from "./mocks/mockProvider.js";

const messages = [{ role: "user" as const, content: "analyze this" }];

describe("runPanel — timeout isolation (G5)", () => {
  it("a slow model times out (aborted, not awaited) while a fast one succeeds", async () => {
    const fast = new MockProvider({
      id: "fast",
      scripts: { "m-fast": [ok("fast answer", undefined, 5)] },
    });
    const slow = new MockProvider({ id: "slow", scripts: { "m-slow": [hang(5000)] } });
    const reg = makeMockRegistry([fast, slow]);

    const startedAt = Date.now();
    const results = await runPanel({
      registry: reg,
      panel: [
        { id: "fast", provider: "fast", model: "m-fast" },
        { id: "slow", provider: "slow", model: "m-slow" },
      ],
      messages,
      perModelTimeoutMs: 60,
    });
    const elapsed = Date.now() - startedAt;

    // The whole call returns in ~60ms, NOT ~5000ms → the slow mock was aborted.
    expect(elapsed).toBeLessThan(1000);

    const fastRes = results.find((r) => r.id === "fast");
    const slowRes = results.find((r) => r.id === "slow");
    expect(fastRes?.ok).toBe(true);
    expect(slowRes?.ok).toBe(false);
    if (slowRes && !slowRes.ok) {
      expect(slowRes.reason).toBe("timeout");
      expect(slowRes.latencyMs).toBeGreaterThanOrEqual(40);
      expect(slowRes.latencyMs).toBeLessThan(1000);
    }
  });

  it("records errors without aborting the rest", async () => {
    const good = new MockProvider({ id: "good", scripts: { g: [ok("ok")] } });
    const bad = new MockProvider({
      id: "bad",
      scripts: { b: [{ kind: "error", message: "503 upstream" }] },
    });
    const reg = makeMockRegistry([good, bad]);
    const results = await runPanel({
      registry: reg,
      panel: [
        { id: "good", provider: "good", model: "g" },
        { id: "bad", provider: "bad", model: "b" },
      ],
      messages,
      perModelTimeoutMs: 1000,
    });
    expect(results.find((r) => r.id === "good")?.ok).toBe(true);
    const badRes = results.find((r) => r.id === "bad");
    expect(badRes?.ok).toBe(false);
    if (badRes && !badRes.ok) expect(badRes.reason).toBe("error");
  });

  it("captures usage + cost for priced providers", async () => {
    const priced = new MockProvider({
      id: "priced",
      price: { input: 1, output: 2 },
      scripts: {
        p: [
          ok("answer", {
            prompt_tokens: 1_000_000,
            completion_tokens: 1_000_000,
            total_tokens: 2_000_000,
          }),
        ],
      },
    });
    const reg = makeMockRegistry([priced]);
    const [res] = await runPanel({
      registry: reg,
      panel: [{ id: "priced", provider: "priced", model: "p" }],
      messages,
      perModelTimeoutMs: 1000,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.priced).toBe(true);
      expect(res.costUsd).toBeCloseTo(3, 6); // 1*1 + 1*2
    }
  });
});
