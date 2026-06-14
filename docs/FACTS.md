# FACTS — Fusion API canonical reference

> **Precedence rule:** If a fact here contradicts another doc (or your memory), **THIS FILE WINS.** Cite this file, not your memory. All facts are dated **2026-06-14**; **verify pricing against live provider pricing pages** before treating any cost number as authoritative.

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

## Illustrative PRICING table

> **Every number below is `[PLACEHOLDER — verify]`.** Do **not** treat these as authoritative. Prices are per **1M tokens** unless noted. Once a value is verified against the live provider pricing page, correct it **here** — this file then wins for that fact. **Local models = $0** (`priced: false`).

| Model | Input ($/1M) | Output ($/1M) | priced |
| --- | --- | --- | --- |
| openai/gpt-4o-class | `[PLACEHOLDER — verify]` | `[PLACEHOLDER — verify]` | true |
| openai/gpt-4o-mini-class | `[PLACEHOLDER — verify]` | `[PLACEHOLDER — verify]` | true |
| anthropic/claude-opus-class | `[PLACEHOLDER — verify]` | `[PLACEHOLDER — verify]` | true |
| anthropic/claude-sonnet-class | `[PLACEHOLDER — verify]` | `[PLACEHOLDER — verify]` | true |
| google/gemini-pro-class | `[PLACEHOLDER — verify]` | `[PLACEHOLDER — verify]` | true |
| openrouter/<any-routed-model> | `[PLACEHOLDER — verify]` | `[PLACEHOLDER — verify]` | true |
| ollama / lmstudio / llamacpp (any local model) | 0 | 0 | **false** |

*Why it matters:* pricing feeds the cost cap (G3). A wrong price either lets a request through that should 402, or blocks one that's actually cheap. This is the **first owner open decision** in `docs/PROGRESS.md`: the owner must verify these.

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
