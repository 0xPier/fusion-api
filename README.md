# Fusion API

A self-hostable, **provider-agnostic** OpenAI-compatible API server that replicates
OpenRouter's **Fusion** feature: run several analysis models in parallel (the *panel*),
have a **judge** model produce structured JSON analysis, then a **synthesizer** write the
final user-facing answer. Works across **local** OpenAI-compatible models (Ollama, LM
Studio, llama.cpp) **and cloud** providers (OpenRouter, OpenAI, native Anthropic, native
Gemini) — mix them freely in one panel.

> This is inference-time **ensemble orchestration**, not a neural MoE. See
> [Value & honest limits](#value--honest-limits).

```
client ──▶ POST /v1/chat/completions ──┬─ plain model ──────────────▶ single provider call
           POST /v1/fusion/completions │
                                       └─ fusion ─▶ panel (parallel) ─▶ judge (strict JSON)
                                                                        ─▶ synthesizer ─▶ answer
                                       returns an OpenAI response + `fusion_metadata`
```

---

## Quick start

```bash
npm install
cp .env.example .env          # fill in keys (or leave blank to use local models only)
npm start                     # listens on :3000 (PORT to override)
```

```bash
curl http://localhost:3000/health
curl http://localhost:3000/v1/models
```

Scripts: `npm start` (run) · `npm run dev` (watch) · `npm run build` (typecheck) ·
`npm test` (Vitest) · `npm run lint` (Biome).

### Configuration

Two layers, merged with precedence **env > config file > built-in default**:

- **Env** (`.env`) — secrets and limits. Required/recognized vars:
  `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
  `OLLAMA_BASE_URL`, `LMSTUDIO_BASE_URL`, `LLAMACPP_BASE_URL`,
  `FUSION_DEFAULT_PRESET`, `FUSION_MAX_PANEL_MODELS`, `FUSION_TIMEOUT_MS`,
  `FUSION_MAX_USD_PER_REQUEST`, `PORT`, `CONFIG_PATH`, `LOG_LEVEL`.
- **Config file** (`CONFIG_PATH`, YAML or JSON) — named models, provider allow/deny lists,
  preset overrides. **Never put keys here.** See [`config.example.yaml`](config.example.yaml).

Secrets are never logged; `*_API_KEY` / `Authorization` / URL credentials are redacted.

---

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/chat/completions` | OpenAI-compatible. Single model, or fusion via a `fusion/*` model id or a `fusion` object. |
| POST | `/v1/fusion/completions` | Explicit fusion. Always fuses unless `fusion.mode:"off"`. |
| GET | `/v1/models` | Configured models + virtual `fusion/quality`, `fusion/budget`, `fusion/local-heavy`, `fusion/cloud-heavy`, `fusion/custom`. |
| GET | `/health` | Server status + per-provider availability. |
| GET | `/v1/fusion/presets` | Preset catalog with cost/quality intent. |
| POST | `/v1/fusion/estimate-cost` | Preflight cost estimate without calling any model. |

### The `fusion` request extension

```jsonc
{
  "model": "fusion/quality",
  "messages": [{ "role": "user", "content": "Analyze this architecture" }],
  "temperature": 0.4,
  "stream": false,
  "fusion": {
    "mode": "auto|forced|off",
    "preset": "quality|budget|local-heavy|cloud-heavy|custom",
    "analysis_models": [
      { "id": "local-qwen", "provider": "ollama", "model": "qwen3", "base_url": "http://localhost:11434/v1" },
      { "id": "cloud-sonnet", "provider": "openrouter", "model": "anthropic/claude-sonnet-4.5" }
    ],
    "judge": { "provider": "openrouter", "model": "anthropic/claude-sonnet-4.5" },
    "synthesizer": { "provider": "openrouter", "model": "anthropic/claude-sonnet-4.5" },
    "max_panel_models": 8,
    "timeout_ms": 120000,
    "web": { "enabled": false },
    "cost": { "track": true, "max_usd_per_request": null }
  }
}
```

**Model reference forms** (for plain single-model calls and panel/judge/synth entries):
`"provider:model"` (e.g. `openrouter:anthropic/claude-sonnet-4.5`, `ollama:qwen3`), a named
model id from your config file, or an explicit `{provider, model, base_url?}` object.

### Response shape

A standard OpenAI `chat.completion`, plus `fusion_metadata` on fusion responses:

```jsonc
{
  "id": "chatcmpl-…", "object": "chat.completion", "created": 1234567890,
  "model": "fusion/quality",
  "choices": [{ "index": 0, "message": { "role": "assistant", "content": "Final answer…" }, "finish_reason": "stop" }],
  "usage": { "prompt_tokens": 1000, "completion_tokens": 500, "total_tokens": 1500 },
  "fusion_metadata": {
    "mode": "forced", "requested_mode": "forced", "preset": "quality", "used_fusion": true,
    "routing_reason": "mode=forced",
    "analysis_models": ["local-qwen", "cloud-sonnet", "cloud-gpt"],
    "judge_model": "judge", "synthesizer_model": "synth",
    "failed_models": [], "latency_ms": { "local-qwen": 3000, "cloud-sonnet": 8000, "judge": 1200, "synth": 1500 },
    "estimated_cost_usd": 0.042, "confidence": "high",
    "cost": { "tracked": true, "cap_usd": null, "priced": true },
    "judge": { "repaired": false, "fell_back": false }
  }
}
```

---

## Curl examples

**1 — Forced fusion**

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fusion/quality",
    "messages": [{"role": "user", "content": "Audit this architecture for failure modes"}],
    "fusion": {"mode": "forced"}
  }'
```

**2 — Mixed local + cloud panel**

```bash
curl -X POST http://localhost:3000/v1/fusion/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fusion/custom",
    "messages": [{"role": "user", "content": "Compare these protocol designs"}],
    "fusion": {
      "mode": "forced",
      "analysis_models": [
        {"id": "local-qwen", "provider": "openai-compatible", "model": "qwen3", "base_url": "http://localhost:11434/v1"},
        {"id": "openrouter-sonnet", "provider": "openrouter", "model": "anthropic/claude-sonnet-4.5"}
      ],
      "judge": {"provider": "openrouter", "model": "anthropic/claude-sonnet-4.5"},
      "synthesizer": {"provider": "openrouter", "model": "anthropic/claude-sonnet-4.5"}
    }
  }'
```

**3 — Local-only (Ollama)** — set `OLLAMA_BASE_URL` (default `http://localhost:11434/v1`):

```bash
curl -X POST http://localhost:3000/v1/fusion/completions -H "Content-Type: application/json" \
  -d '{"model":"fusion/custom","messages":[{"role":"user","content":"Find flaws in this plan"}],
       "fusion":{"mode":"forced",
         "analysis_models":[{"id":"qwen","provider":"ollama","model":"qwen3"},
                            {"id":"llama","provider":"ollama","model":"llama3.1"}],
         "judge":{"provider":"ollama","model":"qwen3"},
         "synthesizer":{"provider":"ollama","model":"qwen3"}}}'
```

**4 — LM Studio** — point a panel model at the LM Studio server:

```bash
curl -X POST http://localhost:3000/v1/chat/completions -H "Content-Type: application/json" \
  -d '{"model":"fusion/custom","messages":[{"role":"user","content":"Critique this design"}],
       "fusion":{"mode":"forced",
         "analysis_models":[{"id":"lms","provider":"lmstudio","model":"llama-3.1-8b-instruct",
                             "base_url":"http://localhost:1234/v1"}],
         "judge":{"provider":"lmstudio","model":"llama-3.1-8b-instruct"},
         "synthesizer":{"provider":"lmstudio","model":"llama-3.1-8b-instruct"}}}'
```

**5 — Cloud-only (quality preset)** — needs `OPENROUTER_API_KEY`:

```bash
curl -X POST http://localhost:3000/v1/chat/completions -H "Content-Type: application/json" \
  -d '{"model":"fusion/quality","messages":[{"role":"user","content":"Security-review this contract"}]}'
```

**6 — Auto routing** — fuses for high-stakes prompts, single-model for simple ones:

```bash
curl -X POST http://localhost:3000/v1/chat/completions -H "Content-Type: application/json" \
  -d '{"model":"fusion/budget","messages":[{"role":"user","content":"Rewrite this sentence"}],"fusion":{"mode":"auto"}}'
# → used_fusion:false (editing task)
```

**7 — Estimate cost first** (no keys required):

```bash
curl -X POST http://localhost:3000/v1/fusion/estimate-cost -H "Content-Type: application/json" \
  -d '{"model":"fusion/quality","messages":[{"role":"user","content":"Audit this architecture"}]}'
```

---

## Value & honest limits

"Near-frontier quality at a fraction of frontier cost" is realistic **for the task class
Fusion is built for** — audits, compare/contrast, find-flaws, research, architecture
critique — and it's a *configuration* outcome, not magic.

- **Why cost can be a fraction.** Cost is additive (`N panel + judge + synth`), so the win is
  in panel composition: **local models cost $0**, and you reserve spend for a capable
  aggregator. A cheap/local diverse panel + a good judge/synth answers for cents vs. ~10–100×
  for always calling one top-tier model.
- **Why quality holds — only on the right tasks.** Ensembling beats any single panel member
  when errors are *uncorrelated* and **verifying is easier than generating**. It does **not**
  conjure capability no panel member has, and it inherits *correlated* blind spots. So:
  near-frontier on the target class — yes; universally best on everything — no.
- **The tuning law:** the **judge + synthesizer are the quality bottleneck**; the panel is the
  breadth/error-correction layer. Don't cheap out on the aggregator.

### Tune for frontier-at-a-fraction-of-cost

1. Start from `budget` or `local-heavy`. Put 2–3 *diverse* models in the panel (different
   families catch different errors); include local ones — they're free.
2. Keep the **judge and synthesizer capable** even when the panel is cheap.
3. A/B with `POST /v1/fusion/estimate-cost` and the `fusion_metadata.estimated_cost_usd` +
   `latency_ms` on real responses; move models until quality holds and cost drops.
4. Leave `mode:"auto"` on for mixed workloads — it skips fusion (and its cost) on simple tasks.

### Cost caveats

- `estimated_cost_usd` is an **estimate**, not billing truth: token counts are approximated as
  `chars/4`, and pricing comes from a static table in
  [`src/providers/pricing.ts`](src/providers/pricing.ts) that **must be verified against live
  provider pricing** (see [`docs/FACTS.md`](docs/FACTS.md) — values are flagged
  `[PLACEHOLDER]`). Local/unknown models count as `$0` and are flagged `priced:false`.
- The cost cap (`fusion.cost.max_usd_per_request`, or `FUSION_MAX_USD_PER_REQUEST` as a hard
  ceiling) blocks **before any spend** at preflight (HTTP 402). A mid-pipeline overrun stops
  forward spend and returns a **partial 200** (`fusion_metadata.cost.stopped_at_stage`) — the
  panel money is already spent, so it returns the best result it has rather than erroring.
- Streamed single-model cost may be absent unless the upstream returns a usage chunk.

---

## Differences from OpenRouter Fusion

- **Self-hosted & provider-agnostic**: you bring your own keys and local servers; mix local +
  cloud in one panel. OpenRouter Fusion is a hosted `openrouter/fusion` model + server tool.
- **Explicit knobs**: presets, panel size (1–8), judge/synth overrides, deterministic auto
  routing, per-request cost cap — all in the request or config.
- **Deterministic auto routing**: a pure keyword heuristic (no hidden classifier LLM), so
  routing is testable and explainable via `fusion_metadata.routing_reason`.
- **v1 scope**: single-model streaming pass-through only (fusion streaming returns a clear
  error); web search is not yet wired (the `web` flag is accepted, no-op).

## Roadmap

- **Streaming for fusion** — a staged event protocol (panel-done → judge-done → synth tokens).
- **Web search** — wire `fusion.web.enabled` to a search tool; only real source URLs are cited.
- **Live model discovery** in `/v1/models` (opt-in, per-provider `listModels`).
- **Tokenizer-accurate** cost estimates and verified live pricing.
- **Metrics** export (Prometheus) — currently structured logs only.

---

## Architecture & docs

Modules: `src/server` (HTTP + dispatch), `src/providers` (BaseProvider + one OpenAI-compatible
adapter + native Anthropic/Gemini + registry), `src/fusion` (router, panel runner, judge +
repair ladder, synthesizer, presets, heuristics, cost), `src/config`, `src/observability`.

This repo ships a **guardrailed build-agent control layer** that governs how it's extended:
[`CLAUDE.md`](CLAUDE.md), [`START_HERE.md`](START_HERE.md), and `docs/` (`ARCHITECTURE.md`,
`FACTS.md`, `AGENT_CONTEXT.md`, `BUILD_PHASES.md`, `PROGRESS.md`, `modules/*`). Read
`START_HERE.md` first.

## Testing

`npm test` runs the Vitest suite (71 tests) entirely against mock providers — **no API keys or
network required**. It covers health, models, single-model + fusion (forced/off/auto), mixed
local/cloud panels, one-model-timeout isolation, judge JSON repair + fallback, the cost cap,
config loading, the registry, and the provider adapters.

## License

MIT.
