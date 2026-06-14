import { describe, expect, it } from "vitest";
import { makeApp, postJson } from "./mocks/makeApp.js";
import { makeMockRegistry } from "./mocks/makeRegistry.js";
import { MockProvider, ok } from "./mocks/mockProvider.js";

describe("POST /v1/chat/completions — non-fusion single model", () => {
  it("returns a standard OpenAI response with NO fusion_metadata", async () => {
    const mock = new MockProvider({
      id: "openai",
      scripts: {
        "gpt-4o": [ok("Paris.", { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 })],
      },
    });
    const app = makeApp(makeMockRegistry([mock]));
    const { status, json } = await postJson(app, "/v1/chat/completions", {
      model: "openai:gpt-4o",
      messages: [{ role: "user", content: "capital of France?" }],
    });
    expect(status).toBe(200);
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.content).toBe("Paris.");
    expect(json.choices[0].message.role).toBe("assistant");
    expect(json.usage.total_tokens).toBe(6);
    expect(json.fusion_metadata).toBeUndefined();
  });

  it("400s on an invalid request body", async () => {
    const app = makeApp(makeMockRegistry([new MockProvider({ id: "openai" })]));
    const { status, json } = await postJson(app, "/v1/chat/completions", { messages: [] });
    expect(status).toBe(400);
    expect(json.error.type).toBe("invalid_request_error");
  });
});
