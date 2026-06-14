import { describe, expect, it } from "vitest";
import { SYNTH_ANSWER, fusionBody, fusionProvider } from "./mocks/fusionMocks.js";
import { makeApp, postJson } from "./mocks/makeApp.js";
import { makeMockRegistry } from "./mocks/makeRegistry.js";

describe("fusion mode = auto", () => {
  it("USES fusion for a complex audit prompt", async () => {
    const provider = fusionProvider();
    const app = makeApp(makeMockRegistry([provider]));
    const { status, json } = await postJson(
      app,
      "/v1/fusion/completions",
      fusionBody({
        mode: "auto",
        content: "Audit this architecture for security vulnerabilities and find flaws",
      }),
    );
    expect(status).toBe(200);
    expect(json.fusion_metadata.used_fusion).toBe(true);
    expect(json.choices[0].message.content).toBe(SYNTH_ANSWER);
    expect(provider.calls).toContain("judge");
  });

  it("SKIPS fusion for a simple rewrite prompt", async () => {
    const provider = fusionProvider();
    const app = makeApp(makeMockRegistry([provider]));
    const { status, json } = await postJson(
      app,
      "/v1/fusion/completions",
      fusionBody({ mode: "auto", content: "Rewrite this sentence to fix the grammar" }),
    );
    expect(status).toBe(200);
    expect(json.fusion_metadata.used_fusion).toBe(false);
    expect(json.fusion_metadata.routing_reason).toMatch(/editing|grammar/);
    // Only the synthesizer was called — no panel, no judge.
    expect(provider.calls).toEqual(["synth"]);
  });
});
