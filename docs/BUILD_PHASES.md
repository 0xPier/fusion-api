# BUILD_PHASES — Fusion API

The 7 phases (0–6). Each phase has a **Goal**, **Why now** (depends-on / unlocks), **Steps**, **Done-when** (the checkable conditions — these are what the vetting gate uses to allow advancement; keep them faithful), and **Common pitfalls**.

> **Advancement rule:** refuse to advance to phase N+1 until phase N passes its **Done-when** checks. Record each pass in `docs/PROGRESS.md`.

---

## Phase 0 — Skeleton & contracts

- **Goal:** Stand up the project skeleton and the type/interface contracts with no implementations.
- **Why now:** Depends on nothing. Unlocks everything — every later phase imports these interfaces.
- **Steps:** `package.json`, `tsconfig.json`, `vitest.config.ts`, `biome.json`; `src/providers/base.ts` (interfaces), `src/fusion/types.ts`, `src/errors.ts`, `src/clock.ts`.
- **Done-when:** `npm run build` + `npm test` pass on an empty test; interfaces compile with no impls.
- **Common pitfalls:**
  - Putting logic in `clock.ts` — it's just `now(): number`, injected so latency is deterministic in tests; if it reads the real clock in tests, latency assertions become flaky.
  - Letting `types.ts` import runtime modules — keep it types + Zod schemas only, or you create import cycles later.

---

## Phase 1 — Providers + registry + mocks

- **Goal:** All provider adapters + the registry + pricing + test mocks.
- **Why now:** Depends on Phase 0 interfaces. Unlocks the server (Phase 2) and the fusion core (Phase 5), which both call providers through the registry.
- **Steps:** `openaiCompatible.ts` (the one shared adapter); `openai.ts` / `openrouter.ts` thin presets; native `anthropic.ts` + native `gemini.ts`; `registry.ts` (build/get/resolve/list/health + allow/deny + URL/id validation); `pricing.ts`; `test/mocks/{mockProvider,makeRegistry}.ts`.
- **Done-when:** a test resolves a `MockProvider` via the registry; `chatCompletion()` returns a scripted response with deterministic `latencyMs`; `healthCheck()` is mockable; a provider-adapter test maps OpenAI↔native shapes.
- **Common pitfalls:**
  - Hand-rolling the Anthropic/Gemini wire shape from memory — use `docs/FACTS.md` (native specifics differ: Anthropic `system` is top-level + `max_tokens` required; Gemini `contents[].parts[].text` with roles `user`/`model`).
  - Skipping URL/id validation in the registry "just for local" — local URLs are exactly where a typo or injected credential slips through (G8/G2).

---

## Phase 2 — Server shell + DI + dispatch (single-model only)

- **Goal:** The Hono app, DI wiring, middleware, and the single-model request path. No fusion yet.
- **Why now:** Depends on Phase 1 (registry). Unlocks fusion dispatch (Phase 5) — the same route gains the fusion branch later.
- **Steps:** `createApp({ registry, config, logger, now })` (closure DI, not `c.env`); requestId + errorHandler middleware; `GET /health`; `GET /v1/models` (incl. the 5 virtual ids); `POST /v1/chat/completions` single-model path; the error envelope.
- **Done-when:** `app.request('/v1/models')` lists virtual + real models; a single-model completion returns an OpenAI-shaped body; `/health` reflects mock availability — all without network.
- **Common pitfalls:**
  - Reaching for Hono `c.env` instead of closure DI — `c.env` makes the fusion core depend on Hono and breaks the network-free `app.request()` tests.
  - Forgetting the 5 virtual ids in `/v1/models` — clients select fusion presets by these ids; missing them silently disables preset selection.

---

## Phase 3 — Pure cores

- **Goal:** The pure, side-effect-free functions: heuristics, presets, cost estimator, cost tracker, JSON repair.
- **Why now:** Depends on Phase 0 types. Unlocks the router (Phase 5), which composes all of these. Pure = fast to test in isolation.
- **Steps:** `heuristics.decideMode()` + TRIGGER/SUPPRESSOR tables; `presets.ts`; `costEstimator.ts`; `costTracker.ts`; `jsonRepair.ts`.
- **Done-when:** heuristic fixtures all match (audit→fusion, grammar-fix→no); `jsonRepair` table cases parse; the estimator gives the expected USD; `wouldExceed` is correct.
- **Common pitfalls:**
  - Making `decideMode` impure (reading config at call time, or an LLM call) — it must be a pure function of its args (G7) or it stops being snapshot-testable.
  - `jsonRepair` "fixing" valid JSON destructively — repair transforms must be idempotent on already-valid input.

---

## Phase 4 — Panel runner

- **Goal:** Parallel panel execution with per-model + global timeout isolation.
- **Why now:** Depends on Phase 1 (providers) + Phase 3 (cost tracker). Unlocks the router (Phase 5), which calls the panel runner first.
- **Steps:** `panelRunner.ts` — `allSettled` + `AbortSignal.any([AbortSignal.timeout(perModelMs), globalController.signal])`; record `latencyMs` on both resolve and reject; build `PanelResult[]`; all-fail → clear error before the judge.
- **Done-when:** a 9999ms mock + a 10ms mock → one `ok:true`, one `ok:false reason:"timeout"` with `latencyMs≈perModelMs`; the slow mock is actually **aborted** (not awaited); all-fail → a clear error.
- **Common pitfalls:**
  - The timeout test passing for the wrong reason — if the mock *resolves late* instead of being **aborted**, the test "passes" but the abort path is dead code. Assert the abort actually fired.
  - Not recording `latencyMs` on the reject path — a timed-out model still needs `latencyMs≈perModelMs` in `failed_models`, or observability lies (G5).

---

## Phase 5 — Judge + ladder + synthesizer + router (fusion enabled)

- **Goal:** The full fusion pipeline end-to-end.
- **Why now:** Depends on Phases 1–4. Unlocks the fusion route, presets, and `fusion_metadata`.
- **Steps:** `judge.ts` (build prompt → call → 4-rung repair ladder → validated `JudgeAnalysis`); `synthesizer.ts`; `router.ts` (normalize → decideMode → select panel → run → cost gates → judge → synth → assemble); wire the fusion branch into `/v1/chat/completions` and `/v1/fusion/completions`.
- **Done-when:** end-to-end `/v1/fusion/completions` with scripted mocks returns a final answer + full `fusion_metadata`; a malformed-judge mock exercises rungs 2→3→4 and still synthesizes with `judge.fell_back:true`; a cost-cap mock → preflight 402 + mid-pipeline partial 200.
- **Common pitfalls:**
  - **Valid JSON ≠ valid shape** — Zod-validate in rung 1; a parse that succeeds is not a validated `JudgeAnalysis`.
  - **A mid-pipeline cost overrun is a partial 200, not a 4xx** — only the *preflight* gate returns 402; pre-judge / pre-synth gates stop forward spend and return a partial 200 with `fusion_metadata.cost.stopped_at_stage`.
  - Rung 2 looping — it must be **exactly one** repair call, or the cost cap is meaningless (G3).

---

## Phase 6 — Streaming + endpoints + hardening + docs

- **Goal:** Single-model SSE relay, the fusion-stream error, the remaining endpoints, redaction hardening, and docs.
- **Why now:** Depends on Phases 2 + 5. Final phase — the product is feature-complete after this.
- **Steps:** single-model `stream:true` SSE relay via `streamSSE`; fusion + `stream:true` → `stream_not_supported` 400 (decided at dispatch, before any work); `GET /v1/fusion/presets`; `POST /v1/fusion/estimate-cost`; logger redaction test; env validation; `README.md` (incl. "Value & honest limits" + the tune-for-cost guide).
- **Done-when:** a streamed single-model mock relays `data:` chunks + `[DONE]`; fusion + stream → `stream_not_supported`; a log-dump test asserts no `*_API_KEY` value appears anywhere.
- **Common pitfalls:**
  - Deciding the fusion+stream error *after* starting work — it must be rejected at dispatch, before any spend (G3/G5), or you've paid for a request you can't stream.
  - A redaction test that only checks the happy path — assert keys are absent from the *raw serialized log line*, including nested `base_url` credentials, not just from a pretty-printed object (G2).
