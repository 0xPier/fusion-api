import { describe, expect, it } from "vitest";
import { makeApp } from "./mocks/makeApp.js";
import { makeMockRegistry } from "./mocks/makeRegistry.js";
import { MockProvider } from "./mocks/mockProvider.js";

describe("GET /v1/models", () => {
  it("lists the 5 virtual fusion ids plus configured + provider models", async () => {
    const reg = makeMockRegistry([new MockProvider({ id: "openrouter" })], {
      namedModels: {
        "cloud-sonnet": { provider: "openrouter", model: "anthropic/claude-sonnet-4.5" },
      },
    });
    const app = makeApp(reg);
    const res = await app.request("/v1/models");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    const ids = json.data.map((m: { id: string }) => m.id);
    expect(json.object).toBe("list");
    for (const v of [
      "fusion/quality",
      "fusion/budget",
      "fusion/local-heavy",
      "fusion/cloud-heavy",
      "fusion/custom",
    ]) {
      expect(ids).toContain(v);
    }
    expect(ids).toContain("cloud-sonnet");
    expect(ids).toContain("openrouter");
  });
});
