# module: fusion (`src/fusion/`)

**What this module owns:** the fusion pipeline — router, panel runner, judge + repair ladder, synthesizer, presets, the pure auto-mode heuristic, cost estimator/tracker, prompt templates, and deterministic JSON repair.

> **Read `START_HERE.md` first.** **Canonical facts live in `docs/FACTS.md`** (panel bounds, token heuristic, default completion tokens, virtual ids) — **link, don't duplicate.** Cites guardrails **G4** (pipeline shape), **G5** (partial failure), **G6** (judge JSON), **G7** (deterministic auto-mode).

---

## The strict judge JSON schema (LOCKED — G6)

The judge must emit exactly this shape; it is Zod-validated before the synthesizer sees it.

| Field | Type | Meaning |
| --- | --- | --- |
| `consensus` | `string[]` | Points the panel agrees on. |
| `contradictions` | `string[]` | Points where panel members disagree. |
| `partial_coverage` | `string[]` | Aspects only some members addressed. |
| `unique_insights` | `string[]` | Valuable points raised by a single member. |
| `blind_spots` | `string[]` | What the whole panel missed. |
| `likely_errors` | `string[]` | Claims the judge flags as probably wrong. |
| `recommended_answer_plan` | `string` | How the synthesizer should structure the final answer. |
| `confidence` | `{ overall: number, notes: string }` | Judge's confidence in the synthesis basis. |
| `model_scores` | `{ model_id: string, strengths: string, weaknesses: string, score: number }[]` | Per-model assessment. |

The fallback (rung 4) is a synthesis-shaped object of this same schema with `recommended_answer_plan` pointing the synthesizer at raw panel outputs, low `confidence.overall`, and `_fallback:true` surfaced as `judge.fell_back` in `fusion_metadata`.

---

## Prompt contracts (FREE wording, LOCKED outputs)

- **Panel prompt** — instructs each model to analyze the user's request independently. Wording is FREE.
- **Judge prompt** — embeds the schema above and demands JSON only. Wording is FREE **as long as the output still matches the locked schema** (G6).
- **Synth prompt** — builds the final answer from messages + judge JSON + high-value panel excerpts; **never** dumps raw deliberation to the user (G4). Wording is FREE.
- **Repair prompt** — the single rung-2 re-prompt (broken output + schema). Wording is FREE.

---

## Presets (`presets.ts`)

Names are LOCKED (the 5 virtual ids); **contents are FREE to tune.** Keep judge/synth capable even in cheap tiers — they're the quality bottleneck.

| Preset | Panel | Judge / Synth | Intent |
| --- | --- | --- | --- |
| `fusion/quality` | 3 strong cloud models | strong / strong | Correctness dominates; highest cost (NOT the cost-saver). |
| `fusion/cloud-heavy` | mostly strong cloud | strong / strong | Hard research/audits where breadth of strong models matters. |
| `fusion/budget` | 1 cheap cloud + 1 local | cheap-mid / mid | The cost-saver: near-frontier on target tasks for ~cents. |
| `fusion/local-heavy` | mostly local ($0) | optional cloud / optional cloud | Cheapest: free panel; one capable cloud aggregator carries final quality. |
| `fusion/custom` | user-specified | user-specified | Entirely caller-defined (requires an explicit `fusion` object). |

Each preset ships a one-line "value note" stating its cost/quality intent.

---

## Auto-mode heuristic (`heuristics.ts`, G7)

`decideMode(messages, opts, config)` is a **pure** function → `{ fusion, reason, matched[] }`. Order: explicit `mode` wins → **suppressors** (grammar fix, casual chat…) → **triggers** (audit, compare, architecture…) → default single-model. TRIGGER/SUPPRESSOR tables are exported constants, snapshot-tested via fixtures. **No LLM call.**

---

## Module do / don'ts

- **Do** keep the pipeline order panel → judge → synth, and the panel parallel + isolated. (G4/G5)
- **Do** Zod-validate the judge output before the synthesizer (rung 1 includes validation). (G6)
- **Do** keep `decideMode` pure and snapshot-tested. (G7)
- **Don't** let the judge be a concatenator, or reorder stages. (G4)
- **Don't** pass unvalidated judge text downstream. (G6)
- **Don't** loop the repair call — rung 2 is exactly one call (cost cap, G3).
- **Don't** expose raw judge JSON / panel debate to the user. (G4)

---

## Quick reference: add a preset

> Preset *names* are locked. You can only tune *contents*; a genuinely new id is an escalate-to-owner change (G1).

1. Edit the preset's panel/judge/synth defaults in `presets.ts`.
2. Keep the aggregator (judge/synth) capable.
3. Update the one-line value note.
4. Update `docs/FACTS.md` if the intent description changes; add/adjust tests; update `docs/PROGRESS.md`.

## Quick reference: tune the heuristic

1. Edit the exported TRIGGER / SUPPRESSOR constant tables in `heuristics.ts`.
2. Keep `decideMode` pure (no config read at call time, no LLM). (G7)
3. Add/adjust fixtures in `test/fixtures/heuristics.ts` so it stays snapshot-tested.
4. Run the heuristic fixtures (Phase 3 done-when); update `docs/PROGRESS.md`.
