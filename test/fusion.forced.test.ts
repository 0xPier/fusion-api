import { describe, expect, it } from "vitest";
import { SYNTH_ANSWER, fusionBody, fusionProvider } from "./mocks/fusionMocks.js";
import { makeApp, postJson } from "./mocks/makeApp.js";
import { makeMockRegistry } from "./mocks/makeRegistry.js";

describe("POST /v1/fusion/completions — forced fusion", () => {
  it("runs panel → judge → synth and returns the answer + full fusion_metadata", async () => {
    const app = makeApp(makeMockRegistry([fusionProvider()]));
    const { status, json } = await postJson(app, "/v1/fusion/completions", fusionBody());

    expect(status).toBe(200);
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.content).toBe(SYNTH_ANSWER);

    const m = json.fusion_metadata;
    expect(m.used_fusion).toBe(true);
    expect(m.mode).toBe("forced");
    expect(m.analysis_models).toEqual(["panel-a", "panel-b"]);
    expect(m.judge_model).toBe("judge");
    expect(m.synthesizer_model).toBe("synth");
    expect(m.failed_models).toEqual([]);
    expect(m.confidence).toBe("high");
    expect(m.judge.fell_back).toBe(false);
    expect(m.latency_ms["panel-a"]).toBeTypeOf("number");
    expect(m.latency_ms.judge).toBeTypeOf("number");
    expect(m.estimated_cost_usd).toBeGreaterThan(0);
  });

  it("also works through /v1/chat/completions with a fusion/* model", async () => {
    const app = makeApp(makeMockRegistry([fusionProvider()]));
    const { status, json } = await postJson(
      app,
      "/v1/chat/completions",
      fusionBody({ model: "fusion/custom" }),
    );
    expect(status).toBe(200);
    expect(json.fusion_metadata.used_fusion).toBe(true);
    expect(json.choices[0].message.content).toBe(SYNTH_ANSWER);
  });
});
