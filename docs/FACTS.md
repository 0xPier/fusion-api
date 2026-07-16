# FACTS — Fusion API canonical reference

> **Precedence rule:** If a fact here contradicts another doc (or your memory), **THIS FILE WINS.** Cite this file, not your memory. Non-pricing facts are dated **2026-06-14**. Pricing values below are populated from `src/providers/pricing.ts` on **2026-06-15** and remain **pending verification** against live provider pricing pages; do not treat them as billing truth until the status column reads `VERIFIED`.

---

## Default base URLs

*Why it matters:* a wrong base URL means the registry can't reach a provider, or — worse — sends a request (with a key) to the wrong host (G2/G8).

| Provider | Default base URL |
| --- | --- |
| Ollama | `http://localhost:11434/v1` |
| LM Studio | `http://localhost:1234/v1` |
| llama.cpp | `http://localhost:8080/v1` |
| OpenAI | `https://api.openai.com/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Anthropic (native) | `https://api.anthropic.com/v1` |
| Gemini (native) | `https://generativelanguage.googleapis.com/v1beta` |

---

## Anthropic native API specifics

*Why it matters:* Anthropic is **not** OpenAI-shaped; mapping it like OpenAI silently produces malformed requests (G8).

| Aspect | Value |
| --- | --- |
| Endpoint | `POST /v1/messages` |
| Auth header | `x-api-key: <key>` |
| Version header | `anthropic-version: 2023-06-01` |
| System prompt | top-level `system` **string** field — NOT a message |
| `max_tokens` | **REQUIRED** |
| Messages | roles `user` / `assistant`, each with `content` |

---

## Gemini native API specifics

*Why it matters:* same as above — Gemini's request body and auth differ from OpenAI's (G8).

| Aspect | Value |
| --- | --- |
| Endpoint | `POST /v1beta/models/<model>:generateContent` |
| Auth | `?key=<key>` query param, or header `x-goog-api-key` |
| Body | `{ "contents": [{ "role": "user"\|"model", "parts": [{"text": "..."}] }], "systemInstruction": {...}, "generationConfig": {...} }` |
| Roles | `user` / `model` (note: `model`, not `assistant`) |

---

## Environment variables

*Why it matters:* the **names** are LOCKED (G-zone). The config layer reads exactly these; renaming one breaks deployments and the redaction allow-list (G2/G3).

| Env var | Meaning |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI cloud key. |
| `OPENROUTER_API_KEY` | OpenRouter cloud key. |
| `ANTHROPIC_API_KEY` | Anthropic native key. |
| `GEMINI_API_KEY` | Gemini native key. |
| `OLLAMA_BASE_URL` | Ollama base URL (default `http://localhost:11434/v1`). |
| `LMSTUDIO_BASE_URL` | LM Studio base URL (default `http://localhost:1234/v1`). |
| `LLAMACPP_BASE_URL` | llama.cpp base URL (default `http://localhost:8080/v1`). |
| `FUSION_DEFAULT_PRESET` | Default preset when none is specified (one of the 5 virtual ids). |
| `FUSION_MAX_PANEL_MODELS` | Upper bound on panel size (default 8). |
| `FUSION_TIMEOUT_MS` | Global fusion deadline in ms. |
| `FUSION_MAX_USD_PER_REQUEST` | Hard cost cap; a request may set a lower cap but never exceed this (G3). |

---

## Panel bounds, token estimate, default completion tokens

*Why it matters:* these drive the preflight cost estimate (G3) and the panel-size validation (G4). Wrong numbers = wrong 402 decisions.

| Item | Value |
| --- | --- |
| Panel size bounds | **1–8** (`max_panel_models` / `FUSION_MAX_PANEL_MODELS`) |
| Token estimate heuristic | `ceil(chars / 4)` |
| Default completion tokens — analysis (panel) | **800** |
| Default completion tokens — judge | **1200** |
| Default completion tokens — synth | **1500** |

---

## The 5 virtual model ids

*Why it matters:* these ids are LOCKED (G1). Clients select fusion behavior by these; renaming or dropping one breaks preset selection.

| Virtual id | Intent |
| --- | --- |
| `fusion/quality` | Correctness dominates; strong cloud panel + strong judge/synth; highest cost. |
| `fusion/budget` | The cost-saver: 1 cheap cloud + 1 local, cheap-mid judge / mid synth. |
| `fusion/local-heavy` | Cheapest: mostly local ($0) panel; one capable cloud aggregator carries final quality. |
| `fusion/cloud-heavy` | Hard research/audits; mostly strong cloud panel; strong judge/synth. |
| `fusion/custom` | Entirely caller-defined; requires an explicit `fusion` object (else 400). |

---

## Pricing table

> Prices are USD per **1M tokens**. Values below are populated from `src/providers/pricing.ts` (2026-06-15) and remain **unverified** until checked against the live provider pricing pages. Once verified, change the status column to `VERIFIED`, update the date, and ensure `src/providers/pricing.ts` matches. **Local models = $0** (`priced: false`). This table is the source of truth for cost estimation.

| Model | Input ($/1M) | Output ($/1M) | priced | Status | Verify at |
| --- | --- | --- | --- | --- | --- |
| **OpenAI (cloud)** |
| `gpt-4o` | 2.50 | 10.00 | true | PENDING | https://openai.com/api/pricing |
| `gpt-4o-mini` | 0.15 | 0.60 | true | PENDING | https://openai.com/api/pricing |
| `gpt-4.1` | 2.00 | 8.00 | true | PENDING | https://openai.com/api/pricing |
| `gpt-4.1-mini` | 0.40 | 1.60 | true | PENDING | https://openai.com/api/pricing |
| `o4-mini` | 1.10 | 4.40 | true | PENDING | https://openai.com/api/pricing |
| **OpenRouter namespaced** |
| `openai/gpt-4o` | 2.50 | 10.00 | true | PENDING | https://openrouter.ai/models/openai/gpt-4o |
| `openai/gpt-4o-mini` | 0.15 | 0.60 | true | PENDING | https://openrouter.ai/models/openai/gpt-4o-mini |
| `anthropic/claude-sonnet-4.5` | 3.00 | 15.00 | true | PENDING | https://openrouter.ai/models/anthropic/claude-sonnet-4.5 |
| `anthropic/claude-opus-4.1` | 15.00 | 75.00 | true | PENDING | https://openrouter.ai/models/anthropic/claude-opus-4.1 |
| `anthropic/claude-haiku-4.5` | 1.00 | 5.00 | true | PENDING | https://openrouter.ai/models/anthropic/claude-haiku-4.5 |
| `google/gemini-2.5-pro` | 1.25 | 10.00 | true | PENDING | https://openrouter.ai/models/google/gemini-2.5-pro |
| `google/gemini-2.5-flash` | 0.30 | 2.50 | true | PENDING | https://openrouter.ai/models/google/gemini-2.5-flash |
| **Anthropic native** |
| `claude-sonnet-4-5` | 3.00 | 15.00 | true | PENDING | https://www.anthropic.com/pricing |
| `claude-opus-4-1` | 15.00 | 75.00 | true | PENDING | https://www.anthropic.com/pricing |
| `claude-haiku-4-5` | 1.00 | 5.00 | true | PENDING | https://www.anthropic.com/pricing |
| **Gemini native** |
| `gemini-2.5-pro` | 1.25 | 10.00 | true | PENDING | https://ai.google.dev/pricing |
| `gemini-2.5-flash` | 0.30 | 2.50 | true | PENDING | https://ai.google.dev/pricing |
| **Local** |
| `ollama` / `lmstudio` / `llamacpp` (any model) | 0 | 0 | **false** | N/A | N/A |

*Why it matters:* pricing feeds the preflight and mid-pipeline cost gates (G3). A wrong price either lets a request through that should 402, or blocks one that's actually cheap. This is the **first owner open decision** in `docs/PROGRESS.md`: the owner must verify these numbers against the live pages.

### Verification checklist

For each row with status `PENDING`, visit the **Verify at** URL, find the exact model id, and confirm the input/output price per 1M tokens. Then edit this table: change `PENDING` → `VERIFIED`, update the date above, and mirror the corrected value into `src/providers/pricing.ts`. Pay special attention to:

1. **OpenRouter markups** — `openai/gpt-4o` via OpenRouter often costs more than direct OpenAI. Do not assume the direct-provider price applies to the OpenRouter row.
2. **Context/cache discounts** — these are base prices; cached-input discounts are not modeled in v1.
3. **New model versions** — model ids with date suffixes (e.g. `gpt-4o-2024-08-06`) are not in the table; the lookup falls back to `priced:false` for unknown ids.
4. **Native vs. routed** — `anthropic/claude-sonnet-4.5` (OpenRouter) and `claude-sonnet-4-5` (native Anthropic) currently share the same placeholder prices; they may differ in reality.

### Coverage check against presets

All non-local models referenced by the built-in presets have a price row:

- `fusion/quality`: `anthropic/claude-sonnet-4.5`, `openai/gpt-4o`, `google/gemini-2.5-pro` → covered.
- `fusion/cloud-heavy`: `anthropic/claude-opus-4.1`, `openai/gpt-4.1`, `google/gemini-2.5-pro`, `anthropic/claude-sonnet-4.5` → covered.
- `fusion/budget`: `openai/gpt-4o-mini` → covered; local `qwen3` → `$0 / priced:false`.
- `fusion/local-heavy`: all local → `$0 / priced:false`.

If you change a preset model, ensure a matching price row exists or the estimator will return `priced:false` and the cost cap will treat that model as free (which is correct for local models but risky for unknown cloud models).

---

## Quick sanity checks ("verify by failing")

Copy-paste these once a local provider is running. **If any come back wrong, stop and fix before building more.**

```sh
# 1. Local provider reachable → expect HTTP 200
curl -s -o /dev/null -w "%{http_code}\n" "$OLLAMA_BASE_URL/models"   # expect 200

# 2. A request over the cost cap → expect HTTP 402 (cost_cap_exceeded)
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST localhost:3000/v1/fusion/completions \
  -H 'content-type: application/json' \
  -d '{"model":"fusion/quality","messages":[{"role":"user","content":"hi"}],"fusion":{"max_usd_per_request":0.0000001}}'   # expect 402

# 3. No API key value ever appears in the logs → expect NO output
#    (replace sk-REDACTME with a known key substring from your env)
grep -R "sk-REDACTME" ./logs ./*.log 2>/dev/null   # expect: (nothing)
```
