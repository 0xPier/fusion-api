# START_HERE — Fusion API

The map for this repo. Read this first, then `CLAUDE.md` (the rules), then `docs/FACTS.md` (the canonical values).

---

## §1 What we're building

A **self-hostable, provider-agnostic, OpenAI-compatible API server** (TypeScript / Node 24 / Hono) that replicates OpenRouter "Fusion": run a **panel** of 1–8 analysis models in parallel, have a **judge** emit strict structured JSON analysis, then a **synthesizer** write the final user-facing answer — across both local OpenAI-compatible models (Ollama, LM Studio, llama.cpp) and cloud providers (OpenRouter, OpenAI, native Anthropic, native Gemini).

**What's locked:** the **8 guardrails** below + the **OpenAI wire format** on shipped endpoints. Everything else is FREE to build (see `CLAUDE.md §3` for the FREE/LOCKED split).

---

## §2 The 8 guardrails

Each has a stable number so refusals can cite "guardrail N", and a one-sentence "why breaking it kills the product".

1. **OpenAI wire-compat is locked.** Fusion only *adds* `fusion_metadata`; it never removes/renames standard fields. — *Breaking it breaks every OpenAI SDK client.*
2. **Secrets never leak.** Redact `*_API_KEY`, `Authorization`, and `base_url` credentials everywhere. — *A leaked key is a financial/security breach.*
3. **Cost cap is enforced.** Preflight estimate blocks (402) before spend; mid-pipeline gates stop forward spend. — *Unbounded fan-out cost is the core risk of an inference-time ensemble.*
4. **Fusion pipeline shape is fixed.** panel (1–8, parallel) → judge (strict JSON, never the final answer) → synthesizer (user answer, never raw deliberation). — *This IS the product; a naive merge is not Fusion.*
5. **Partial failure never fails the whole call.** Isolate per-model; record in `failed_models`; only an all-panel failure errors. — *Resilience is the point of an ensemble.*
6. **Judge output must be valid structured JSON.** Enforce via the repair ladder; never hand unvalidated judge text to the synthesizer. — *Downstream synthesis depends on the contract.*
7. **Auto-mode is deterministic and explainable.** Pure keyword/heuristic function; no hidden LLM classifier; returns matched signals. — *Determinism keeps routing testable, debuggable, cost-predictable.*
8. **Provider abstraction is uniform.** Every provider implements `BaseProvider`; OpenAI-compatible providers share one adapter; validate model ids + local URLs; honor allow/deny. — *Uniformity is what makes it provider-agnostic.*

---

## §3 Architecture in one diagram

```
                       ┌──────────────────────────────────────────────────────────────┐
client (OpenAI SDK)    │                         Fusion API server                      │
       │               │                                                                │
       ▼               │   POST /v1/chat/completions ──┐                                 │
  request body ────────┼──▶ POST /v1/fusion/completions┤── validate (Zod) ── dispatch    │
                       │                                │                                 │
                       │              ┌─────────────────┴─────────────────┐               │
                       │      single-model path                   fusion path             │
                       │              │                                   │               │
                       │      provider.chatCompletion()        ┌──────────▼───────────┐   │
                       │              │                        │     FusionRouter      │   │
                       │              │                        │ panel (1–8, PARALLEL) │   │
                       │              │                        │        ▼              │   │
                       │              │                        │ judge → strict JSON   │◀──┼── judge JSON
                       │              │                        │   (= THE CONTRACT)    │   │   schema is
                       │              │                        │        ▼              │   │   the contract
                       │              │                        │ synthesizer → answer  │   │
                       │              │                        └──────────┬───────────┘   │
                       │              └────────────────┬──────────────────┘               │
                       │                               ▼                                  │
                       │        OpenAI-compatible response  ( + fusion_metadata )          │
                       │                                                                  │
                       │   provider registry: resolve(provider, model, base_url?)          │
                       │     → allow/deny + URL/id validation → BaseProvider impls         │
                       │       (openai-compatible adapter | native Anthropic | native      │
                       │        Gemini)                                                    │
                       └──────────────────────────────────────────────────────────────┘
```

- The **provider registry** is the single gate for "may this provider/model be called" (allow/deny + URL/id validation).
- The **judge JSON schema is the contract**: panel feeds the judge, the judge's validated JSON feeds the synthesizer. Nothing skips it.

---

## §4 Where to look next (read order)

1. `CLAUDE.md` — the rules: zones, vetting gate, refusal catalog, explainer mandate.
2. `docs/FACTS.md` — canonical values; **this file wins** over memory.
3. `docs/BUILD_PHASES.md` + `docs/PROGRESS.md` — what to build next; what's verified.
4. `docs/ARCHITECTURE.md` — stack, invariants, data flow, trust model.
5. `docs/AGENT_CONTEXT.md` — the *why* behind each locked choice (numbered).
6. `docs/modules/{providers,fusion,server,config,observability}.md` — the subsystem you're touching.
7. `start.md` — the human-facing kickoff and scripted session.

---

## §5 Anti-patterns to refuse on sight

- Renaming/removing OpenAI response fields (G1).
- Logging raw API keys or `base_url` credentials (G2).
- Removing/bypassing any cost gate; unbounded fan-out (G3).
- Judge-as-concatenator, or reordering panel/judge/synth (G4).
- Aborting the whole call on one model's failure (G5).
- Passing unvalidated judge text to the synthesizer (G6).
- An LLM-based auto-mode classifier (G7).
- A provider that doesn't implement `BaseProvider` / skips validation (G8).

---

## §6 If you only remember one paragraph

The Fusion API turns **breadth into reliability**: a diverse panel runs in parallel, a judge **verifies and structures** their work into strict JSON (the contract), and a synthesizer writes the clean answer — and it does this while staying a drop-in OpenAI server. The **trust model** is narrow on purpose: callers may set fusion config and a cost cap but can never exceed the env cap; providers are only reachable through the registry's allow/deny + URL/id validation; logs never see raw keys; one slow model degrades gracefully instead of failing the call. The judge+synth are the **quality bottleneck**; the panel is the breadth/error-correction layer. Protect those properties (the 8 guardrails) and the product holds; break any one and it stops being Fusion.
