import { describe, expect, it } from "vitest";
import { VALID_JUDGE } from "./mocks/fusionMocks.js";
import { makeApp, postJson } from "./mocks/makeApp.js";
import { makeMockRegistry } from "./mocks/makeRegistry.js";
import { MockProvider, ok } from "./mocks/mockProvider.js";

describe("mixed local + cloud panel", () => {
  it("runs a panel spanning a local provider and a cloud provider", async () => {
    const local = new MockProvider({
      id: "ollama",
      type: "local",
      scripts: { qwen3: [ok("Local analysis: bounded queue prevents overload.")] },
    });
    const cloud = new MockProvider({
      id: "openrouter",
      type: "cloud",
      price: { input: 3, output: 15 },
      scripts: {
        "anthropic/claude-sonnet-4.5": [
          ok("Cloud analysis: add backpressure and a circuit breaker."),
        ],
        judge: [ok(VALID_JUDGE)],
        synth: [ok("Final: bounded queue + backpressure + circuit breaker.")],
      },
    });
    const app = makeApp(makeMockRegistry([local, cloud]));

    const body = {
      model: "fusion/custom",
      messages: [{ role: "user", content: "Compare these protocol designs" }],
      fusion: {
        mode: "forced",
        analysis_models: [
          { id: "local-qwen", provider: "ollama", model: "qwen3" },
          { id: "cloud-sonnet", provider: "openrouter", model: "anthropic/claude-sonnet-4.5" },
        ],
        judge: { provider: "openrouter", model: "judge" },
        synthesizer: { provider: "openrouter", model: "synth" },
      },
    };
    const { status, json } = await postJson(app, "/v1/fusion/completions", body);

    expect(status).toBe(200);
    expect(json.fusion_metadata.analysis_models).toEqual(["local-qwen", "cloud-sonnet"]);
    expect(json.fusion_metadata.failed_models).toEqual([]);
    expect(json.choices[0].message.content).toContain("circuit breaker");
    expect(local.calls).toEqual(["qwen3"]);
    expect(cloud.calls).toContain("anthropic/claude-sonnet-4.5");
  });
});
