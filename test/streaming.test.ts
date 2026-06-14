import { describe, expect, it } from "vitest";
import { makeApp } from "./mocks/makeApp.js";
import { makeMockRegistry } from "./mocks/makeRegistry.js";
import { MockProvider } from "./mocks/mockProvider.js";

const headers = { "content-type": "application/json" };

describe("streaming", () => {
  it("passes through SSE for a non-fusion single model", async () => {
    const mock = new MockProvider({ id: "openai", streamChunks: ["Hello", " world"] });
    const app = makeApp(makeMockRegistry([mock]));
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "openai:gpt-4o",
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain("Hello");
    expect(text).toContain("world");
    expect(text).toContain("[DONE]");
  });

  it("returns stream_not_supported for fusion + stream", async () => {
    const mock = new MockProvider({ id: "openrouter" });
    const app = makeApp(makeMockRegistry([mock]));
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "fusion/quality",
        stream: true,
        messages: [{ role: "user", content: "audit" }],
      }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.error.type).toBe("stream_not_supported");
  });
});
