# module: observability (`src/observability/`)

**What this module owns:** the structured, request-scoped JSON logger with secret redaction. (`metrics.ts` is deferred to v2 — a counter map in the logger/health suffices for now.)

> **Read `START_HERE.md` first.** **Canonical facts live in `docs/FACTS.md`** (the secret names to redact live alongside the env vars) — **link, don't duplicate.** Cites guardrail **G2** (secrets never leak).

---

## What's logged

Structured JSON, **request-scoped**, keyed by a request id (`crypto.randomUUID`, propagated via the `x-request-id` middleware). Per request, record:

- `request_id`
- `latency_ms` per model (panel members, judge, synth)
- token usage per stage
- `estimated_cost_usd` (and whether `priced`)
- `failed_providers` / `failed_models` with `reason`
- the stage the pipeline stopped at, if a cost gate fired

These feed the operator's ability to A/B presets for the quality/cost operating point (see `docs/AGENT_CONTEXT.md §2` value framing).

---

## Redaction rules (G2)

Before **any** line is written, redact:

- `*_API_KEY` (any env or field whose name ends in `_API_KEY`)
- `Authorization` headers
- credentials embedded in a `base_url` (e.g. `https://user:pass@host` → host only)

Redaction is centralized here so every other module can log freely without each one re-implementing masking. The Phase 6 redaction test asserts no key value appears in the **raw serialized log line**, including nested `base_url` credentials.

---

## Module do / don'ts

- **Do** route all logging through this logger so redaction is guaranteed. (G2)
- **Do** include the `request_id` on every line so a request is traceable end-to-end.
- **Don't** log a raw request/response object that may carry a key or `Authorization` header without passing it through redaction. (G2)
- **Don't** log full prompt bodies if they could contain secrets the caller pasted; prefer lengths/hashes for large fields.

---

## Quick reference: log a new event safely

1. Use the request-scoped logger (carries `request_id`); don't `console.log`.
2. Build the event object with the fields you need.
3. If any field could hold a secret (`*_API_KEY`, `Authorization`, a credentialed `base_url`), confirm it flows through redaction — extend the redaction allow-list if it's a new secret-shaped field. (G2)
4. Add/extend the redaction test if you introduced a new secret-bearing field; update `docs/PROGRESS.md`.
