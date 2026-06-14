# module: server (`src/server/`)

**What this module owns:** the Hono app + DI wiring, the HTTP endpoints, the single-vs-fusion dispatch rule, the error envelope, and streaming behavior.

> **Read `START_HERE.md` first.** **Canonical facts live in `docs/FACTS.md`** (virtual ids, env vars) — **link, don't duplicate.** Cites guardrail **G1** (OpenAI wire-compat is locked).

---

## Endpoints

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /v1/chat/completions` | OpenAI chat-completion body (+ optional `fusion` object) | OpenAI-compatible body (+ `fusion_metadata` when fused) |
| `POST /v1/fusion/completions` | Same body; `fusion.mode` defaulted to `forced` | Same as above |
| `GET /v1/models` | — | OpenAI `{ object:"list", data:[...] }` incl. the 5 virtual fusion/* ids |
| `GET /health` | — | `{ status, providers: [{ id, ok, latency_ms }] }` (per-provider `healthCheck()` fan-out) |
| `GET /v1/fusion/presets` | — | The preset definitions |
| `POST /v1/fusion/estimate-cost` | A fusion request body | A preflight cost estimate (no spend) |

**OpenAI-shaped completion response (LOCKED fields — G1):** `id`, `object`, `created`, `model`, `choices[].message`, `choices[].finish_reason`, `usage`. Fusion **adds** `fusion_metadata`; it never removes/renames these.

---

## Dispatch rule (single vs fusion)

In order, inside `/v1/chat/completions`:

1. Validate body (Zod).
2. If `stream:true` **and** fusion-intent → early `stream_not_supported` **400** (before any work).
3. `isFusion = model.startsWith('fusion/') || (body.fusion && body.fusion.mode !== 'off')`.
4. Map `fusion/<preset>` → preset (`fusion/custom` without a `fusion` object → **400**; an explicit `fusion` object overrides preset fields).
5. Fusion → `FusionRouter.run()` (`auto` resolved inside the router); else single-model path.

`/v1/fusion/completions` is the same path with `fusion.mode` defaulted to `forced`.

---

## Error envelope

All errors serialize to one shape; the `errorHandler` middleware maps typed `FusionError`s to HTTP status:

```json
{ "error": { "type": "string", "code": "string", "message": "string", "details": { } } }
```

Known mappings: cost cap preflight → **402** `cost_cap_exceeded`; fusion + stream → **400** `stream_not_supported`; `fusion/custom` without `fusion` → **400`; all-panel failure → a clear error before the judge.

---

## Streaming

- Non-fusion single-model `stream:true` → proxy the upstream SSE via `streamSSE` (set `stream_options.include_usage` for cloud; document that local streamed cost may be absent).
- Fusion + `stream:true` → `stream_not_supported` **400**, decided at dispatch **before any work** (a partial pipeline can't be streamed; G3/G5).

---

## Module do / don'ts

- **Do** keep every shipped response OpenAI-compatible; add only `fusion_metadata`. (G1)
- **Do** use closure DI (`createApp({ registry, config, logger, now })`), not Hono `c.env`, so the fusion core stays Hono-free and `app.request()` tests stay network-free.
- **Don't** rename or drop standard OpenAI fields. (G1)
- **Don't** start fusion work before deciding the stream/fusion error. (G3/G5)

---

## Quick reference: add an endpoint without breaking compat

1. New endpoints are FREE as long as they don't change the shape of an existing shipped one. (G1)
2. Mount the route under `src/server/routes/`; wire it in `createApp`.
3. Reuse the Zod schemas (`src/config/schema.ts`) for validation and the shared error envelope.
4. If it spends money, route it through the cost gates. (G3)
5. Add a test (`app.request()`, no network); update `docs/PROGRESS.md`.
