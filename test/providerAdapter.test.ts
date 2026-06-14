import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { GeminiProvider } from "../src/providers/gemini.js";
import { OpenAICompatibleProvider } from "../src/providers/openaiCompatible.js";

interface Captured {
  url: string;
  init: RequestInit;
}

function stubFetch(responseBody: unknown, captured: Captured[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      captured.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenAICompatibleProvider adapter", () => {
  it("posts OpenAI-shaped body with bearer auth and parses the response", async () => {
    const captured: Captured[] = [];
    stubFetch(
      {
        model: "gpt-4o",
        choices: [{ message: { content: "hi there" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
      },
      captured,
    );
    const p = new OpenAICompatibleProvider({
      id: "openai",
      name: "OpenAI",
      type: "cloud",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    });
    const res = await p.chatCompletion({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.content).toBe("hi there");
    expect(res.usage?.total_tokens).toBe(13);

    const call = captured[0];
    expect(call.url).toBe("https://api.openai.com/v1/chat/completions");
    expect((call.init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const body = JSON.parse(call.init.body as string);
    expect(body.stream).toBe(false);
    expect(body.messages[0]).toEqual({ role: "user", content: "hi" });
  });

  it("local providers report priced:false from estimateCost", () => {
    const p = new OpenAICompatibleProvider({
      id: "ollama",
      name: "Ollama",
      type: "local",
      baseUrl: "http://localhost:11434/v1",
    });
    expect(p.estimateCost({ promptTokens: 1000, completionTokens: 1000 }, "qwen3")).toEqual({
      usd: 0,
      priced: false,
    });
  });
});

describe("AnthropicProvider native adapter", () => {
  it("maps system to a top-level field, sets max_tokens + version header, parses content[]", async () => {
    const captured: Captured[] = [];
    stubFetch(
      {
        model: "claude-sonnet-4-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "answer" }],
        usage: { input_tokens: 20, output_tokens: 5 },
      },
      captured,
    );
    const p = new AnthropicProvider("ak-test");
    const res = await p.chatCompletion({
      model: "claude-sonnet-4-5",
      messages: [
        { role: "system", content: "be terse" },
        { role: "user", content: "hello" },
      ],
    });
    expect(res.content).toBe("answer");
    expect(res.usage).toEqual({ prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 });

    const call = captured[0];
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("ak-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(call.init.body as string);
    expect(body.system).toBe("be terse");
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
  });
});

describe("GeminiProvider native adapter", () => {
  it("maps roles, uses x-goog-api-key header (key not in URL), parses candidates", async () => {
    const captured: Captured[] = [];
    stubFetch(
      {
        candidates: [{ content: { parts: [{ text: "gem answer" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 16 },
      },
      captured,
    );
    const p = new GeminiProvider("gk-test");
    const res = await p.chatCompletion({
      model: "gemini-2.5-pro",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "u2" },
      ],
    });
    expect(res.content).toBe("gem answer");
    expect(res.usage?.total_tokens).toBe(16);

    const call = captured[0];
    expect(call.url).toContain(":generateContent");
    expect(call.url).not.toContain("gk-test"); // key must NOT be in the URL (G2)
    expect((call.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("gk-test");
    const body = JSON.parse(call.init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
  });
});
