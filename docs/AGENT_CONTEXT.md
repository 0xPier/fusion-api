# AGENT_CONTEXT — Fusion API rationale

> Numbered so the refusal catalog and other docs can cite **§N** here. Read `START_HERE.md` first, then this for the *why*. Canonical values live in `docs/FACTS.md` (link, don't duplicate).

---

## §1 What the locked core is

The locked core is two things and only two things: the **8 guardrails** and the **OpenAI wire format** on shipped endpoints. Everything else — module names, prompt wording, preset contents, heuristic tables, pricing values, logging format — is FREE to change (see `CLAUDE.md §3`). The locked core is small on purpose: a small, explicit contract is what lets the agent build fast everywhere else without re-litigating the design.

---

## §2 Numbered design principles (one per guardrail)

1. **OpenAI wire-compat (G1).** Why it exists: the entire value of "OpenAI-compatible" is that any existing OpenAI SDK client works unchanged. What breaks without it: every client breaks the moment a field is renamed; the product stops being a drop-in. Fusion is therefore strictly **additive** (`fusion_metadata`).

2. **Secrets never leak (G2).** Why it exists: keys are bearer credentials with a direct dollar cost. What breaks without it: a single shared log file or shipped bundle becomes a financial breach. Redaction covers `*_API_KEY`, `Authorization`, and credentials embedded in `base_url`s.

3. **Cost cap enforced (G3).** Why it exists: an inference-time ensemble multiplies spend (N panel + judge + synth). What breaks without it: an operator gets a surprise bill; the "fraction of the cost" claim collapses. The cap is a hard env ceiling a per-request cap can only *lower*.

4. **Fusion pipeline shape fixed (G4).** Why it exists: panel → judge(JSON) → synth **is** the product. What breaks without it: a naive concatenation or merge looks similar but loses the verify-and-structure step that produces the quality lift — it's no longer Fusion.

5. **Partial failure never fails the whole call (G5).** Why it exists: resilience is the entire reason to run an ensemble. What breaks without it: one slow/erroring model makes the whole feature flakier than a single model — the opposite of the goal.

6. **Judge output must be valid structured JSON (G6).** Why it exists: the synthesizer consumes the judge's JSON as a contract. What breaks without it: unvalidated text downstream produces garbage answers or crashes; the repair ladder exists to keep this contract under real-world model output.

7. **Auto-mode deterministic & explainable (G7).** Why it exists: routing decisions must be testable, debuggable, and cost-predictable. What breaks without it: a hidden LLM classifier makes routing non-deterministic, adds cost on every request, and can't be snapshot-tested.

8. **Provider abstraction uniform (G8).** Why it exists: "provider-agnostic" only holds if every provider goes through the same `BaseProvider` gate with the same validation. What breaks without it: a bespoke provider skips model-id/URL validation and allow/deny enforcement — a security and correctness hole.

### The tuning law

The **judge + synthesizer are the quality bottleneck**; the **panel is the breadth/error-correction layer**. The cheapest *effective* configuration is therefore a **cheap/local diverse panel + a still-capable aggregator** (judge/synth). Don't cheap out on the judge/synth to save money — that's where quality actually comes from. This is why `fusion/local-heavy` keeps a capable cloud aggregator over a free local panel.

### Value & honest limits

- **Why cost can be a fraction:** cost is additive, so the win comes from panel composition. Local models cost **$0**; spend is reserved for the aggregator. A cheap/local diverse panel + a capable judge/synth answers for cents vs. ~10–100× for always calling one top-tier model. (Ratios depend on live pricing; see the populated-but-pending-verification table in [`docs/FACTS.md`](docs/FACTS.md).)
- **Why quality holds — only on the right tasks:** ensembling beats any single panel member when errors are **uncorrelated** and **verifying is easier than generating** (the generator–verifier gap) — exactly audits / compare / find-flaws / research / architecture critique. It does **not** conjure capability no panel member has, and it inherits *correlated* blind spots.
- **Honest framing:** near-frontier on the target task class — yes; universal "frontier-level on everything" — no. This is **inference-time ensemble orchestration, not true neural MoE.** No marketing claims in docs.
- **Make it measurable:** `fusion_metadata.estimated_cost_usd` + per-model latency let the operator A/B presets to find their quality/cost operating point. `auto` mode also saves money by skipping Fusion on simple tasks.

---

## §3 The fusion pipeline lifecycle / flow

```
normalize  → decide mode → select panel → run panel (parallel) → cost gates → judge + repair ladder → synth → assemble
```

1. **normalize** — coerce the request into the internal `FusionRequest`; resolve `fusion/<preset>` → preset, with an explicit `fusion` object overriding preset fields.
2. **decide mode** — pure `decideMode()`; `auto` resolves *inside* the router (explicit mode wins → suppressors → triggers → default single-model).
3. **select panel** — pick the panel models (1–8) per preset/request.
4. **run panel (parallel)** — `allSettled` + per-model + global abort; record latency on success and failure.
5. **cost gates** — the 3-gate cap (see §4).
6. **judge + repair ladder** — build the judge prompt, call once, run the 4-rung ladder to a validated `JudgeAnalysis`.
7. **synth** — write the user-facing answer from messages + judge JSON + high-value panel excerpts.
8. **assemble** — OpenAI-shaped response + `fusion_metadata`.

---

## §4 Key mechanics not to break

- **Cost-cap 3-gate timing (G3):**
  - **Preflight** gate blocks **optimistically** — it sums estimates for panel×N + judge + synth *before any spend*; over cap → HTTP **402** `cost_cap_exceeded`.
  - **Mid-pipeline** gates (pre-judge, pre-synth) only decide **forward spend** — they stop the pipeline and return a **partial 200** (`fusion_metadata.cost.stopped_at_stage`). An **overrun is a partial 200, never a 4xx.**
  - Local/unknown-price models cost 0 but are flagged `priced:false`.

- **The 4-rung judge repair ladder (G6):**
  1. strip code fences → `JSON.parse` → **Zod-validate** (valid JSON ≠ valid shape).
  2. **exactly one** repair call (re-prompt the same judge with its broken output + the schema).
  3. deterministic `jsonRepair` (extract first balanced `{…}`, strip trailing commas, normalize smart quotes) → partial-validate (missing arrays → `[]`).
  4. **synthesis-shaped fallback** object: `recommended_answer_plan` tells the synthesizer to work from raw panel outputs; `confidence.overall` low; `_fallback:true` surfaced in `fusion_metadata` (as `judge.fell_back`).

- **`AbortSignal.any` per-model + global deadline (G5):** each call uses `AbortSignal.any([AbortSignal.timeout(perModelMs), globalController.signal])`; `globalController` enforces the total `timeout_ms`. Distinguish `TimeoutError` (`reason:"timeout"`) from other errors. Record `latencyMs` on both resolve and reject paths.

---

## §5 Known simplifications / open points

- **Native Anthropic / Gemini adapters are real but light** — they cover the chat-completion path needed for panel/judge/synth, not the providers' full feature surface.
- **Streaming is single-model pass-through only** — fusion + `stream:true` returns `stream_not_supported` (decided at dispatch). Streaming a multi-stage pipeline is out of v1 scope.
- **Web search is a stub / roadmap** — not executed in v1.
- **Pricing values need verification** — `docs/FACTS.md` now contains a populated pricing table sourced from `src/providers/pricing.ts`, but every value still has status `PENDING` until verified against the live provider pricing pages. Treat correcting them as **escalate-to-owner** (it's the first item in `docs/PROGRESS.md` open decisions); the values feed the cost cap, so a guess here has real financial consequences.
