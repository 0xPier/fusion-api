import { describe, expect, it } from "vitest";
import { FusionError } from "../src/errors.js";
import { makeMockRegistry } from "./mocks/makeRegistry.js";
import { MockProvider } from "./mocks/mockProvider.js";

describe("Registry.resolve", () => {
  const ollama = new MockProvider({ id: "ollama", type: "local" });
  const openrouter = new MockProvider({ id: "openrouter", type: "cloud" });

  it("resolves a provider + model directly", () => {
    const reg = makeMockRegistry([ollama, openrouter]);
    const r = reg.resolve({ provider: "openrouter", model: "anthropic/claude-sonnet-4.5" });
    expect(r.provider.id).toBe("openrouter");
    expect(r.model).toBe("anthropic/claude-sonnet-4.5");
  });

  it("expands a named model id from config", () => {
    const reg = makeMockRegistry([ollama, openrouter], {
      namedModels: {
        "cloud-sonnet": { provider: "openrouter", model: "anthropic/claude-sonnet-4.5" },
      },
    });
    const r = reg.resolve({ provider: "cloud-sonnet", model: "cloud-sonnet" });
    expect(r.provider.id).toBe("openrouter");
    expect(r.model).toBe("anthropic/claude-sonnet-4.5");
  });

  it("rejects an unknown provider", () => {
    const reg = makeMockRegistry([ollama]);
    expect(() => reg.resolve({ provider: "nope", model: "x" })).toThrow(FusionError);
  });

  it("rejects invalid model ids", () => {
    const reg = makeMockRegistry([openrouter]);
    expect(() => reg.resolve({ provider: "openrouter", model: "bad model id\n" })).toThrow(
      /invalid model id/,
    );
  });

  it("enforces deny (deny wins)", () => {
    const reg = makeMockRegistry([openrouter], { deny: ["openrouter"] });
    expect(() => reg.resolve({ provider: "openrouter", model: "x" })).toThrow(/denied/);
  });

  it("enforces a non-empty allow-list", () => {
    const reg = makeMockRegistry([ollama, openrouter], { allow: ["ollama"] });
    expect(() => reg.resolve({ provider: "openrouter", model: "x" })).toThrow(/allow-list/);
    expect(reg.resolve({ provider: "ollama", model: "qwen3" }).provider.id).toBe("ollama");
  });

  it("builds an ephemeral local provider for a localhost base_url", () => {
    const reg = makeMockRegistry([]);
    const r = reg.resolve({
      provider: "openai-compatible",
      model: "qwen3",
      base_url: "http://localhost:11434/v1",
    });
    expect(r.provider.type).toBe("local");
    expect(r.model).toBe("qwen3");
  });

  it("rejects a non-http base_url", () => {
    const reg = makeMockRegistry([]);
    expect(() =>
      reg.resolve({ provider: "openai-compatible", model: "x", base_url: "ftp://example.com" }),
    ).toThrow(/base_url must be http/);
  });

  it("reports per-provider health", async () => {
    const healthy = new MockProvider({ id: "a", health: { ok: true } });
    const down = new MockProvider({ id: "b", health: { ok: false, detail: "boom" } });
    const reg = makeMockRegistry([healthy, down]);
    const h = await reg.health();
    expect(h.a.ok).toBe(true);
    expect(h.b.ok).toBe(false);
  });
});
