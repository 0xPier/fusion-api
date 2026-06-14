import { describe, expect, it } from "vitest";
import { SYNTH_ANSWER, VALID_JUDGE } from "./mocks/fusionMocks.js";
import { makeApp, postJson, testConfig } from "./mocks/makeApp.js";
import { makeMockRegistry } from "./mocks/makeRegistry.js";
import { MockProvider, hang, ok } from "./mocks/mockProvider.js";

describe("one panel model timing out does NOT fail the whole fusion call (G5)", () => {
  it("isolates the timeout, still judges + synthesizes, reports it in failed_models", async () => {
    const provider = new MockProvider({
      id: "mock",
      type: "cloud",
      price: { input: 1, output: 2 },
      scripts: {
        fast: [ok("Fast panel answer with substance.")],
        slow: [hang(5000)],
        judge: [ok(VALID_JUDGE)],
        synth: [ok(SYNTH_ANSWER)],
      },
    });
    const app = makeApp(makeMockRegistry([provider]), testConfig({ timeoutMs: 80 }));

    const body = {
      model: "fusion/custom",
      messages: [{ role: "user", content: "Audit this for failure modes" }],
      fusion: {
        mode: "forced",
        analysis_models: [
          { id: "fast", provider: "mock", model: "fast" },
          { id: "slow", provider: "mock", model: "slow" },
        ],
        judge: { provider: "mock", model: "judge" },
        synthesizer: { provider: "mock", model: "synth" },
      },
    };

    const startedAt = Date.now();
    const { status, json } = await postJson(app, "/v1/fusion/completions", body);
    const elapsed = Date.now() - startedAt;

    expect(status).toBe(200);
    expect(elapsed).toBeLessThan(2000); // the slow model was aborted, not awaited
    expect(json.fusion_metadata.used_fusion).toBe(true);
    expect(json.choices[0].message.content).toBe(SYNTH_ANSWER);
    expect(json.fusion_metadata.analysis_models).toEqual(["fast", "slow"]);

    const failed = json.fusion_metadata.failed_models;
    expect(failed).toHaveLength(1);
    expect(failed[0].id).toBe("slow");
    expect(failed[0].reason).toBe("timeout");
  });
});
