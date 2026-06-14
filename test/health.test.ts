import { describe, expect, it } from "vitest";
import { makeApp } from "./mocks/makeApp.js";
import { makeMockRegistry } from "./mocks/makeRegistry.js";
import { MockProvider } from "./mocks/mockProvider.js";

describe("GET /health", () => {
  it("reports server status and per-provider availability", async () => {
    const reg = makeMockRegistry([
      new MockProvider({ id: "openrouter", health: { ok: true } }),
      new MockProvider({
        id: "ollama",
        type: "local",
        health: { ok: false, detail: "connection refused" },
      }),
    ]);
    const app = makeApp(reg);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.status).toBe("ok");
    expect(json.providers.openrouter.ok).toBe(true);
    expect(json.providers.ollama.ok).toBe(false);
    expect(json.providers_available).toBe(1);
    expect(json.fusion_models).toContain("fusion/quality");
  });
});
