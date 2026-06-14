import { describe, expect, it } from "vitest";
import { SYNTH_ANSWER, fusionBody, fusionProvider } from "./mocks/fusionMocks.js";
import { makeApp, postJson } from "./mocks/makeApp.js";
import { makeMockRegistry } from "./mocks/makeRegistry.js";

describe("fusion mode = off", () => {
  it("does a single-model call (no panel/judge), used_fusion:false", async () => {
    const provider = fusionProvider();
    const app = makeApp(makeMockRegistry([provider]));
    const { status, json } = await postJson(
      app,
      "/v1/fusion/completions",
      fusionBody({ mode: "off" }),
    );

    expect(status).toBe(200);
    expect(json.choices[0].message.content).toBe(SYNTH_ANSWER); // synthesizer used as the single writer
    expect(json.fusion_metadata.used_fusion).toBe(false);
    expect(json.fusion_metadata.judge_model).toBeNull();
    expect(json.fusion_metadata.analysis_models).toEqual([]);
    // Only ONE upstream call was made (the synthesizer), not the panel + judge.
    expect(provider.calls).toEqual(["synth"]);
  });
});
