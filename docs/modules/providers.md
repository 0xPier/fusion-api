# module: providers (`src/providers/`)

**What this module owns:** every provider adapter, the one shared OpenAI-compatible adapter, the native Anthropic/Gemini adapters, the provider registry (resolve / allow-deny / URL-id validation), and the static pricing table.

> **Read `START_HERE.md` first.** **Canonical facts live in `docs/FACTS.md`** (base URLs, native API specifics, pricing) — **link, don't duplicate.** Cites guardrails **G8** (uniform abstraction) and **G2** (secrets never leak).

---

## Authoritative interface (LOCKED — G8)

```ts
interface BaseProvider {
  id: string;                  // stable provider id (e.g. "openai", "ollama")
  name: string;                // human label
  type: 'local' | 'cloud';     // drives pricing + healthcheck expectations
  chatCompletion(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
  listModels?(): Promise<ModelInfo[]>;     // optional
  healthCheck(): Promise<HealthStatus>;
  estimateCost?(req: ChatRequest): CostEstimate;  // optional; local → priced:false
}
```

- **Shared OpenAI-compatible adapter** (`openaiCompatible.ts`): one implementation for Ollama, LM Studio, llama.cpp, OpenAI, OpenRouter. Only `base_url`, key, and headers differ. `openai.ts` / `openrouter.ts` are thin config presets over it (OpenRouter adds attribution headers + pricing).
- **Native Anthropic** (`anthropic.ts`): `POST /v1/messages`; headers `x-api-key` + `anthropic-version: 2023-06-01`; `system` is a top-level string (not a message); `max_tokens` is required; map OpenAI `messages` → Anthropic `user`/`assistant` + extract `system`. (Full specifics in `docs/FACTS.md`.)
- **Native Gemini** (`gemini.ts`): `POST /v1beta/models/<model>:generateContent`; `?key=` or `x-goog-api-key`; map `messages` → `contents[].parts[].text` with roles `user`/`model`; `system` → `systemInstruction`. (Full specifics in `docs/FACTS.md`.)
- **Registry** (`registry.ts`): builds providers from config; `get` / `resolve(provider, model, base_url?)` / `list` / `health`; enforces **allow/deny lists** and **model-id + base-URL validation** before any provider is reachable.

---

## Module do / don'ts

- **Do** make every new provider implement `BaseProvider`. (G8)
- **Do** reuse `openaiCompatible.ts` for any OpenAI-shaped provider; write a native adapter only when the wire shape genuinely differs (Anthropic/Gemini). (G8)
- **Do** validate model ids and base URLs in the registry — including local ones. (G8/G2)
- **Don't** add a provider that bypasses `BaseProvider` or the registry's validation. (G8)
- **Don't** let a key or `base_url` credential reach a log or error message; the registry/adapters hand redaction to the logger. (G2)
- **Don't** assume a provider is OpenAI-shaped — check `docs/FACTS.md` before mapping.

---

## Quick reference: add a new provider

1. Decide: OpenAI-shaped → reuse `openaiCompatible.ts`; otherwise a native adapter (model your mapping on `anthropic.ts` / `gemini.ts`).
2. Implement `BaseProvider` (id, name, type, `chatCompletion`, `healthCheck`; optional `listModels`/`estimateCost`).
3. Add the default base URL + any pricing rows (mark new pricing `[PLACEHOLDER — verify]`) — facts go in `docs/FACTS.md`.
4. Register it in `registry.ts`; confirm allow/deny + model-id + URL validation apply.
5. Add a provider-adapter test mapping request/response shapes (Phase 1 done-when).
6. Update `docs/PROGRESS.md` and explain the change per `CLAUDE.md §5`.
