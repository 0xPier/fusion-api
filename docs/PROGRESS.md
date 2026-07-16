# PROGRESS — Fusion API build state

> Runtime state tracker. The agent reads this at session start and updates it after **every verified step** (a done-when condition actually passes — not "I wrote it"). **The human's manual edits win** — if a line was hand-edited, reconcile around it, don't clobber it.

---

## Current phase

**All v1 phases complete.** Server builds, lints, and passes the full mock-driven suite.

---

## Phase checklist

- [x] **Phase 0 — Skeleton & contracts** — `npm run build` + `npm test` pass on an empty test; interfaces compile with no impls.
- [x] **Phase 1 — Providers + registry + mocks** — registry resolves a `MockProvider`; scripted `chatCompletion()` with deterministic `latencyMs`; mockable `healthCheck()`; adapter maps OpenAI↔native shapes.
- [x] **Phase 2 — Server shell + DI + dispatch (single-model only)** — `/v1/models` lists virtual + real; single-model completion returns OpenAI-shaped body; `/health` reflects mock availability; all without network.
- [x] **Phase 3 — Pure cores** — heuristic fixtures all match; `jsonRepair` table cases parse; estimator gives expected USD; `wouldExceed` correct.
- [x] **Phase 4 — Panel runner** — one `ok:true` + one `ok:false reason:"timeout"` with `latencyMs≈perModelMs`; slow mock actually aborted; all-fail → clear error.
- [x] **Phase 5 — Judge + ladder + synthesizer + router (fusion enabled)** — end-to-end fusion returns answer + full `fusion_metadata`; malformed-judge mock exercises the repair ladder and still synthesizes with `judge.fell_back:true`; cost-cap mock → preflight 402.
- [x] **Phase 6 — Streaming + endpoints + hardening + docs** — streamed single-model relays chunks + `[DONE]`; fusion+stream → `stream_not_supported`; log-dump test asserts no `*_API_KEY` value appears.

---

## Recorded artifacts

| Item | Value |
| --- | --- |
| Chosen HTTP port | 3000 (env `PORT`) |
| Registered providers | openai, openrouter, anthropic (native), gemini (native) [if keyed]; ollama, lmstudio, llamacpp (always) |
| Default preset | quality (env `FUSION_DEFAULT_PRESET`) |
| Last passing test count | 71 (Vitest, mock-driven) |
| Toolchain | Node 24.16.0 · tsc clean · Biome clean · 71/71 tests green |

---

## Owner's open decisions

- [ ] **Verify / confirm model pricing values** — `docs/FACTS.md` now contains a populated pricing table (sourced from `src/providers/pricing.ts`) with per-row verification status and source URLs; the owner must visit each URL, confirm input/output prices, mark rows `VERIFIED`, and mirror corrections into `src/providers/pricing.ts`.

---

## Session log

| Date | Phase | What changed |
| --- | --- | --- |
| 2026-06-14 | — | repo scaffolded, control-layer docs created |
| 2026-06-14 | 0–6 | full Fusion API implemented (TS/Hono); 71 tests green; tsc + Biome clean; README written |
| 2026-06-15 | 6 | re-verified on Node 24.16.0: `npm run build`, `npm test` (71/71), `biome check` all pass |
| 2026-06-15 | 6 | populated `docs/FACTS.md` pricing table from `src/providers/pricing.ts`; added per-row verification status, source URLs, and owner checklist; updated `docs/AGENT_CONTEXT.md` and `docs/PROGRESS.md` open decision |

---

## Notes / blockers

_(free-form — empty)_
