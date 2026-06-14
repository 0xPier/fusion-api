import { describe, expect, it } from "vitest";
import { fusionBody, fusionProvider } from "./mocks/fusionMocks.js";
import { makeApp, postJson } from "./mocks/makeApp.js";
import { makeMockRegistry } from "./mocks/makeRegistry.js";

describe("cost cap (G3)", () => {
  it("blocks at preflight with HTTP 402 when the estimate exceeds the cap", async () => {
    const app = makeApp(makeMockRegistry([fusionProvider()]));
    const body = fusionBody({
      panelModelNames: ["openai/gpt-4o", "openai/gpt-4o"], // priced models → estimate > 0
      cost: { track: true, max_usd_per_request: 0.0000001 },
    });
    const { status, json } = await postJson(app, "/v1/fusion/completions", body);

    expect(status).toBe(402);
    expect(json.error.type).toBe("cost_cap_exceeded");
    expect(json.error.code).toBe("fusion_cost_cap");
    expect(json.error.details.stage).toBe("preflight");
    expect(json.error.details.cap_usd).toBe(0.0000001);
    expect(json.error.details.estimated_usd).toBeGreaterThan(0.0000001);
  });

  it("allows the request under a generous cap", async () => {
    const app = makeApp(makeMockRegistry([fusionProvider()]));
    const body = fusionBody({
      panelModelNames: ["openai/gpt-4o", "openai/gpt-4o"],
      cost: { track: true, max_usd_per_request: 100 },
    });
    const { status, json } = await postJson(app, "/v1/fusion/completions", body);
    expect(status).toBe(200);
    expect(json.fusion_metadata.used_fusion).toBe(true);
    expect(json.fusion_metadata.cost.cap_usd).toBe(100);
  });
});
