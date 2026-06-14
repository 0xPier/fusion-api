import { describe, expect, it } from "vitest";
import { SYNTH_ANSWER, VALID_JUDGE, fusionBody, fusionProvider } from "./mocks/fusionMocks.js";
import { makeApp, postJson } from "./mocks/makeApp.js";
import { makeMockRegistry } from "./mocks/makeRegistry.js";
import { ok } from "./mocks/mockProvider.js";

describe("judge strict-JSON repair ladder (G6)", () => {
  it("repairs malformed judge JSON via the single repair call (rung 2)", async () => {
    const malformed =
      '```json\n{"consensus":["x"], "confidence":{"overall":"medium","notes":""},}\n```';
    // judge queue: malformed first, valid on the repair call
    const provider = fusionProvider([ok(malformed), ok(VALID_JUDGE)]);
    const app = makeApp(makeMockRegistry([provider]));
    const { status, json } = await postJson(app, "/v1/fusion/completions", fusionBody());

    expect(status).toBe(200);
    expect(json.fusion_metadata.judge.repaired).toBe(true);
    expect(json.fusion_metadata.judge.fell_back).toBe(false);
    expect(json.fusion_metadata.confidence).toBe("high");
    expect(json.choices[0].message.content).toBe(SYNTH_ANSWER);
  });

  it("falls back to a structured judge object when all rungs fail, and STILL synthesizes", async () => {
    const provider = fusionProvider([ok("not json at all"), ok("still not json")]);
    const app = makeApp(makeMockRegistry([provider]));
    const { status, json } = await postJson(app, "/v1/fusion/completions", fusionBody());

    expect(status).toBe(200);
    expect(json.fusion_metadata.judge.fell_back).toBe(true);
    expect(json.fusion_metadata.confidence).toBe("low");
    // Synthesis still runs (fallback plan instructs it to use raw panel output).
    expect(json.choices[0].message.content).toBe(SYNTH_ANSWER);
  });
});
