# ARCHITECTURE — Fusion API

Read `START_HERE.md` first. Canonical values live in `docs/FACTS.md` (link, don't duplicate). The *why* behind each choice is in `docs/AGENT_CONTEXT.md`.

---

## §1 Stack at a glance (LOCKED stack choices)

| Concern | Choice | Why |
| --- | --- | --- |
| Runtime / lang | Node 24, TypeScript (ESM, `"type":"module"`, NodeNext, strict) | Matches the owner's other TS projects. |
| HTTP | **Hono** + `@hono/node-server` | `app.request()` gives network-free in-process tests; `streamSSE` + Web-standard `Request`/`Response`/`ReadableStream` match the `fetch`-based provider layer. |
| Validation | **Zod** | One schema source for request bodies + config + judge JSON. |
| Provider calls | native `fetch` + `AbortSignal.timeout/any` | No axios; `AbortSignal.any([timeout, global])` gives per-model + global-deadline isolation. |
| Tests | **Vitest** | Fast TS, easy mocking. |
| Config | `yaml` + `dotenv` | YAML/JSON config + env. |
| Lint / format | **Biome** + `tsc --noEmit` | One lint/format tool instead of eslint+prettier+plugins. |
| Pkg manager | **npm** | Universal; home dir already uses npm. |

Reuse Node built-ins (`crypto.randomUUID` for request IDs, `fetch`, `AbortSignal`) instead of adding deps. **Swapping any stack choice is an escalate-to-owner decision.**

---

## §2 Numbered invariants (guardrails at the system level)

1. Shipped endpoints stay **OpenAI wire-compatible**; fusion only adds `fusion_metadata`. (G1)
2. No secret value ever reaches a log or a config dump; redaction is centralized. (G2)
3. Every spending path passes a cost gate; the env cap is a hard ceiling. (G3)
4. The pipeline is exactly panel → judge(JSON) → synth, in that order. (G4)
5. Panel execution is failure-isolated; only an all-panel failure errors the call. (G5)
6. The judge's output is always a Zod-validated `JudgeAnalysis` before the synthesizer sees it. (G6)
7. Auto-mode is a pure, deterministic function with no LLM call. (G7)
8. Every provider is a `BaseProvider` behind the registry's validation gate. (G8)

---

## §3 Data flow

**Request path:**

```
request → validate (Zod) → dispatch
                              ├─ single-model → provider.chatCompletion() → OpenAI response
                              └─ fusion       → FusionRouter (see fusion path)
```

**Dispatch rule:** `isFusion = model.startsWith('fusion/') || (body.fusion && body.fusion.mode !== 'off')`. `fusion/<preset>` maps to a preset; `fusion/custom` without a `fusion` object → 400; an explicit `fusion` object overrides preset fields. `auto` is resolved **inside** the router.

**Fusion path:**

```
normalize → decideMode → select panel → run panel (PARALLEL) ──┐
                                                               │  [SPENDS MONEY: panel calls]
   preflight cost gate (402 if over) ──before any spend──────┘
        ↓
   pre-judge gate (partial 200 if forward spend over cap)
        ↓
   judge → 4-rung repair ladder → validated JudgeAnalysis        [SPENDS MONEY: judge call]
        ↓
   pre-synth gate (return judge JSON if forward spend over cap)
        ↓
   synthesizer → final answer                                    [SPENDS MONEY: synth call]
        ↓
   assemble: OpenAI response + fusion_metadata
```

**The only stages that spend money** are the panel calls, the judge call, and the synth call. The preflight gate runs *before* any of them; the mid-pipeline gates run *between* them.

---

## §4 Subsystems

- **server** (`src/server/`) — `createApp({ registry, config, logger, now })` builds the Hono app over **injected** deps (closure DI, not `c.env`). Routes: `chat`, `fusion`, `models`, `health`. Middleware: `requestId`, `errorHandler`, `validation`.
- **providers** (`src/providers/`) — `BaseProvider` impls + the one shared OpenAI-compatible adapter + native Anthropic/Gemini + the registry. See `docs/modules/providers.md`.
- **fusion** (`src/fusion/`) — the router, panel runner, judge + ladder, synthesizer, presets, heuristics, cost estimator/tracker, prompts, json repair. See `docs/modules/fusion.md`.
- **config** (`src/config/`) — env (`env.ts`), all Zod schemas (`schema.ts`), merged config (`config.ts`). See `docs/modules/config.md`.
- **observability** (`src/observability/`) — structured JSON logger with secret redaction. See `docs/modules/observability.md`.

**`BaseProvider` interface skeleton (LOCKED — G8):**
```ts
interface BaseProvider {
  id: string;
  name: string;
  type: 'local' | 'cloud';
  chatCompletion(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
  listModels?(): Promise<ModelInfo[]>;
  healthCheck(): Promise<HealthStatus>;
  estimateCost?(req: ChatRequest): CostEstimate;
}
```

**Judge JSON schema fields (LOCKED — G6):**
`consensus`, `contradictions`, `partial_coverage`, `unique_insights`, `blind_spots`, `likely_errors`, `recommended_answer_plan`, `confidence { overall, notes }`, `model_scores[] { model_id, strengths, weaknesses, score }`.

---

## §5 Trust model

| Actor | Powers (and their hard limits) |
| --- | --- |
| **Caller** | May set fusion config (mode, panel, preset) and a per-request `max_usd_per_request`. **Cannot exceed** the env cap `FUSION_MAX_USD_PER_REQUEST` — a per-request cap can only *lower* it. Cannot select a provider that fails validation. |
| **Provider** | May be called **only if** it passes the registry's allow/deny list **and** model-id + base-URL validation. A provider that isn't a registered `BaseProvider` is unreachable. |
| **Logger** | Never sees raw keys. Redacts `*_API_KEY`, `Authorization`, and `base_url` credentials before anything is written. |
| **Synthesizer** | Sees the validated judge JSON + panel excerpts; produces the user answer. Never emits raw deliberation to the user. |

**If you need a power not listed here, push back on the design** — escalate to the owner rather than widening the trust model silently.

---

## §6 Verify by failing

These behaviors are the system contract; assert them, don't assume them.

- Cost cap exceeded (preflight) → **HTTP 402** `cost_cap_exceeded`.
- Bad / malformed local `base_url` → **rejected at the registry**, never called.
- One panel model times out → the call **still succeeds (200)** with `failed_models` populated and `latency_ms` recorded.
- `stream:true` + fusion → **`stream_not_supported` (400)**, decided at dispatch before any spend.
