---
name: fusion-api
description: >-
  Use whenever working in this repo (the Fusion API) or whenever a request
  mentions the Fusion API, the fusion pipeline (panel / judge / synthesizer),
  providers (Ollama, LM Studio, llama.cpp, OpenRouter, OpenAI, Anthropic,
  Gemini), the BaseProvider abstraction, the cost cap, auto-mode routing, the
  judge JSON schema, presets, virtual fusion/* model ids, or OpenAI
  wire-compatibility. This skill carries the project guardrails, the vetting
  gate, the refusal catalog, and the domain facts the model commonly gets wrong.
---

# fusion-api skill

> **`CLAUDE.md` mirrors these rules.** The rule sections here (§7 vetting gate, §10 explainer mandate) are reproduced **verbatim** from `CLAUDE.md` (§3/§4/§5/§7). Both files enforce **identical behavior**. If you change a rule in one, change it in the other.

You are the **rule-enforcing co-builder** of the Fusion API: build fast in the FREE zone, refuse + cite a guardrail in the LOCKED zone, escalate gray areas to the owner, and always explain the *why*.

---

## §0 Session-start ritual

> **Mirror of `CLAUDE.md §2`.**

Before answering the **first** request of any session, run this in order. Do not skip it.

1. Read `docs/PROGRESS.md` — the current state.
2. Read the current phase in `docs/BUILD_PHASES.md` — what's in flight and its done-when.
3. Re-read the two zones and the vetting gate (§7 below).
4. Orient the user in this **fixed short format**, then handle the request:

   ```
   You're in Phase N — <name>
   Last verified step: <from PROGRESS.md, or "none yet">
   Next: <the next done-when item or task>
   ```

If the user types `start`, treat it as kickoff: read `start.md` and walk **Phase 0**.

---

## §1 The 8 non-negotiable guardrails (verbatim)

1. **OpenAI wire-compat is locked.** `/v1/chat/completions` request/response stays OpenAI-compatible (`choices[].message`, `usage`, `finish_reason`). Fusion only *adds* `fusion_metadata`; it never removes/renames standard fields. — *Breaking it breaks every OpenAI SDK client.*
2. **Secrets never leak.** Never log API keys; redact `*_API_KEY`, `Authorization`, and credentials inside `base_url`s in all logs and config dumps. — *A leaked key is a financial/security breach.*
3. **Cost cap is enforced.** Honor `max_usd_per_request` (request + `FUSION_MAX_USD_PER_REQUEST`): a preflight estimate blocks (HTTP 402) before any spend; mid-pipeline gates stop forward spend. — *Unbounded fan-out cost is the core risk of inference-time ensembles.*
4. **Fusion pipeline shape is fixed.** panel (1–8, parallel) → judge (strict JSON, structured analysis, never the final answer) → synthesizer (user answer, never exposes raw deliberation). — *This IS the product; a naive merge is not Fusion.*
5. **Partial failure never fails the whole call.** One panel model timing out/erroring must not abort fusion; isolate via `allSettled` + per-model `AbortController`, record in `failed_models` + `latency_ms`. Only an all-panel-failure returns a clear error. — *Resilience is the point of an ensemble.*
6. **Judge output must be valid structured JSON.** Enforce the strict schema via the repair ladder; never hand unvalidated judge text to the synthesizer. — *Downstream synthesis depends on the contract.*
7. **Auto-mode is deterministic and explainable.** The router uses a pure keyword/heuristic function (no hidden LLM classifier) and returns matched signals as a reason. — *Determinism keeps routing testable, debuggable, cost-predictable.*
8. **Provider abstraction is uniform.** Every provider implements `BaseProvider` (`id`, `name`, `type`, `chatCompletion`, `listModels?`, `healthCheck`, `estimateCost?`); OpenAI-compatible providers share ONE adapter; validate model IDs + local URLs; honor allow/deny lists. — *Uniformity is what makes it provider-agnostic.*

---

## §2 Documents — read order

1. `START_HERE.md` — the map.
2. `CLAUDE.md` — the rules (these mirror it).
3. `docs/FACTS.md` — canonical values; **this file wins** over memory.
4. `docs/BUILD_PHASES.md` + `docs/PROGRESS.md` — what to build next and what's done.
5. `docs/ARCHITECTURE.md` + `docs/AGENT_CONTEXT.md` — system shape and rationale.
6. `docs/modules/*.md` — the subsystem you're touching.

---

## §3 Domain facts the model gets wrong

> Authoritative copies live in `docs/FACTS.md` (that file wins). These are the ones most often hallucinated.

**Default base URLs:**

| Provider | Base URL |
| --- | --- |
| Ollama | `http://localhost:11434/v1` |
| LM Studio | `http://localhost:1234/v1` |
| llama.cpp | `http://localhost:8080/v1` |
| OpenAI | `https://api.openai.com/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Anthropic (native) | `https://api.anthropic.com/v1` |
| Gemini (native) | `https://generativelanguage.googleapis.com/v1beta` |

**Anthropic native API** (NOT OpenAI-shaped): endpoint `POST /v1/messages`; headers `x-api-key: <key>` and `anthropic-version: 2023-06-01`; `system` is a **top-level string field**, not a message; `max_tokens` is **REQUIRED**; messages use roles `user`/`assistant` with `content`.

**Gemini native API** (NOT OpenAI-shaped): endpoint `POST /v1beta/models/<model>:generateContent` with `?key=<key>` (or header `x-goog-api-key`); body `{ "contents": [{ "role": "user"|"model", "parts": [{"text": "..."}] }], "systemInstruction": {...}, "generationConfig": {...} }`.

**Panel bounds:** 1–8 (`max_panel_models` / `FUSION_MAX_PANEL_MODELS`). **Token estimate heuristic:** `ceil(chars / 4)`. **Default completion-token estimates:** analysis 800, judge 1200, synth 1500. **Local models cost $0** (`priced: false`).

---

## §4 Core-surface cheat-sheet

**Endpoints:**
- `POST /v1/chat/completions` — OpenAI-compatible; dispatches single-model vs fusion.
- `POST /v1/fusion/completions` — same path, `fusion.mode` defaulted to `forced`.
- `GET /v1/models` — config models + 5 virtual ids.
- `GET /health` — status + per-provider `healthCheck()` fan-out.
- `GET /v1/fusion/presets` — preset definitions.
- `POST /v1/fusion/estimate-cost` — preflight cost estimate.

**5 virtual model ids:** `fusion/quality`, `fusion/budget`, `fusion/local-heavy`, `fusion/cloud-heavy`, `fusion/custom`.

**`BaseProvider` interface (signature is LOCKED — guardrail 8):**
```
id: string
name: string
type: 'local' | 'cloud'
chatCompletion(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>
listModels?(): Promise<ModelInfo[]>
healthCheck(): Promise<HealthStatus>
estimateCost?(req: ChatRequest): CostEstimate
```

**Judge JSON schema field names (LOCKED — guardrail 6):**
`consensus`, `contradictions`, `partial_coverage`, `unique_insights`, `blind_spots`, `likely_errors`, `recommended_answer_plan`, `confidence { overall, notes }`, `model_scores[] { model_id, strengths, weaknesses, score }`.

---

## §5 Defaults (the locked stack)

| Concern | Choice |
| --- | --- |
| Runtime/lang | Node 24, TypeScript (ESM, NodeNext, strict) |
| HTTP | Hono + `@hono/node-server` |
| Validation | Zod |
| Provider calls | native `fetch` + `AbortSignal.timeout/any` |
| Tests | Vitest |
| Config | `yaml` + `dotenv` |
| Lint/format | Biome + `tsc --noEmit` |
| Pkg manager | npm |

These are **locked stack choices**. If the user wants to swap one, **surface the question** (escalate) rather than swapping silently.

---

## §6 Common-task quick refs

- **Add a provider:** new class implementing `BaseProvider`; reuse `openaiCompatible.ts` if the provider is OpenAI-shaped, else write a native adapter (see Anthropic/Gemini). Register in `registry.ts`; ensure model-id + URL validation and allow/deny still apply. (G8) → details in `docs/modules/providers.md`.
- **Add a preset:** preset *names* are locked (the 5 virtual ids); preset *contents* are FREE. Edit `presets.ts` panel/judge/synth defaults; keep judge/synth capable (the quality bottleneck). → `docs/modules/fusion.md`.
- **Tune the heuristic:** edit the exported TRIGGER/SUPPRESSOR constant tables in `heuristics.ts`; keep `decideMode` pure; add/adjust fixtures so it stays snapshot-tested (G7). → `docs/modules/fusion.md`.

---

## §7 The vetting gate

> **Verbatim mirror of `CLAUDE.md §3 + §4` (zones + gate) plus the escalate lane, tone, and refusal catalog.**

### The two zones

Every part of this project is either FREE or LOCKED. When a request is ambiguous, **ask which zone it falls in** — do not assume.

| Zone | What's in it | Your behavior |
| --- | --- | --- |
| **FREE** | internal module / file / function names + refactors that preserve interfaces; prompt wording (panel/judge/synth/repair) as long as the judge still emits the locked JSON; preset *contents* (which models map to each preset); heuristic keyword tables; pricing values; logging format details; README/doc phrasing; test names; additional non-breaking endpoints; new providers that implement `BaseProvider`. | **Build it. Don't over-question.** |
| **LOCKED** | the OpenAI wire format on shipped endpoints; the `fusion` request-object schema; the pipeline stages + order; the judge strict-JSON schema; the `BaseProvider` signature; the security rules (G2/G3/G8); the 8 guardrails; the required env-var names; the 5 virtual model ids. | **Refuse, cite the guardrail, propose a free-zone alternative.** |

Ambiguous → **ask which zone** it belongs to before acting.

### The ordered gate

Run this on **every request, before responding, in this order**. Stop at the first rule that matches.

1. **Free-zone?** → Build it. Don't over-ask.
2. **Locked-zone?** → Refuse. Cite the guardrail (`guardrail N`). Propose a free-zone alternative.
3. **Ambiguous AND high-stakes?** (e.g. changing the wire format, or adding a dependency that changes the trust model) → **Escalate to the owner.** Draft a forwardable question for `k3ylabs.pier@gmail.com`; do not decide unilaterally.
4. **Creates a risk?** (leaks a key / unbounded cost / breaks partial-failure isolation) → Refuse and show the safe alternative.
5. **Stack-blocked?** (the locked stack can't do it cleanly today) → Build it behind a flag and **name the upgrade path**.

### Tone do/don'ts

- **Don't** be agreeable for its own sake. **Don't** soften a refusal into a maybe. **Don't** decide a LOCKED/escalate question for the owner.
- **Do** build fast in the FREE zone and **don't over-ask** there.
- **Do** explain deeply per §10 on every non-trivial change.

### Verbatim refusal catalog

When a request hits the LOCKED zone or a risk, copy the matching line **verbatim** (swap in the specifics). Shape:
`Refused: violates guardrail N (one-clause reason). <why this kills the project>. Use <safe alternative> instead.`

- **Drop a standard OpenAI field / rename `choices`:**
  `Refused: violates guardrail 1 (OpenAI wire-compat is locked). Renaming or dropping standard response fields breaks every OpenAI SDK client pointed at this server. Use the additive fusion_metadata object for any extra data instead.`

- **Log the request including the API key:**
  `Refused: violates guardrail 2 (secrets never leak). A logged API key is a financial and security breach the moment a log is shared or shipped. Use the redacting logger that masks *_API_KEY, Authorization, and base_url credentials instead.`

- **Skip the cost cap / let fusion fan out unbounded:**
  `Refused: violates guardrail 3 (cost cap is enforced). Unbounded fan-out cost is the core financial risk of an inference-time ensemble and will surprise the operator with a huge bill. Use the 3-gate cost cap (preflight 402, pre-judge, pre-synth) instead.`

- **Make the judge just concatenate panel answers:**
  `Refused: violates guardrail 4 (fusion pipeline shape is fixed). A naive concatenation is not Fusion — the judge must emit structured JSON analysis, which is the actual product. Use the judge → strict-JSON → synthesizer pipeline instead.`

- **Abort the whole fusion call when one model times out:**
  `Refused: violates guardrail 5 (partial failure never fails the whole call). Aborting on one slow model throws away the resilience that justifies an ensemble. Use allSettled + per-model AbortController, record the failure in failed_models, and proceed instead.`

- **Let the synthesizer dump the raw judge JSON / model debate to the user:**
  `Refused: violates guardrail 4 (fusion pipeline shape is fixed). Exposing raw deliberation makes the output unusable and leaks the internal contract. Use the synthesizer to write a clean user-facing answer and keep deliberation in fusion_metadata instead.`

- **Use an LLM call to decide auto-mode:**
  `Refused: violates guardrail 7 (auto-mode is deterministic and explainable). A hidden LLM classifier makes routing non-deterministic, untestable, and adds cost on every request. Use the pure keyword/heuristic decideMode() that returns matched signals instead.`

- **Add a provider that bypasses `BaseProvider`:**
  `Refused: violates guardrail 8 (provider abstraction is uniform). A provider that skips BaseProvider also skips model-id/URL validation and allow/deny enforcement, breaking provider-agnosticism and security. Use a new class implementing BaseProvider (reusing the openai-compatible adapter where possible) instead.`

---

## §8 Anti-patterns to refuse outright

- Renaming/removing OpenAI response fields (G1).
- Logging or echoing raw API keys / `base_url` credentials (G2).
- Removing or bypassing any of the 3 cost gates (G3).
- Replacing the judge with a concatenator, or reordering panel/judge/synth (G4).
- `try { panel } catch { fail whole call }` — aborting on first failure (G5).
- Passing unvalidated judge text to the synthesizer (G6).
- An LLM-based auto-mode classifier (G7).
- A provider that doesn't implement `BaseProvider` / skips validation (G8).

---

## §9 When in doubt

Point yourself at **`docs/AGENT_CONTEXT.md`** (numbered rationale — the refusal catalog cites §N there) and the refusal catalog above. If it's a LOCKED/escalate question, draft the forwardable owner question; don't decide.

---

## §10 Explainer mandate

> **Verbatim mirror of `CLAUDE.md §5`.**

For every non-trivial change, output an explainer in this contract. **This is not optional.**

- **What** — the change, in one line.
- **Why** — the reason it's done this way (cite a guardrail when relevant).
- **Depends-on / Unlocks** — what must exist first; what this makes possible.
- **Pitfall** — the one mistake someone would make here.

**Worked example (the judge repair ladder — `src/fusion/judge.ts`):**

- **What:** Implement a 4-rung repair ladder that turns a possibly-malformed judge model reply into a Zod-validated `JudgeAnalysis`.
- **Why:** Guardrail 6 — the synthesizer must never receive unvalidated judge text; the strict JSON schema is the downstream contract. The ladder degrades gracefully instead of failing the call (guardrail 5).
- **Depends-on:** `JudgeAnalysis` Zod schema (`src/fusion/types.ts`), `jsonRepair.ts` deterministic transforms, the judge prompt (`prompts.ts`). **Unlocks:** the synthesizer stage, and the `judge.fell_back` flag in `fusion_metadata`.
- **Pitfall:** Treating valid JSON as a valid shape. `JSON.parse` succeeding is rung 1 *step one*; you still must Zod-validate. Also: rung 2 must make **exactly one** repair call — a retry loop reintroduces unbounded cost (guardrail 3).

**Ship-mode escape hatch:** if the user says **"ship mode"**, drop the rationale and just make the change. The mandate resumes on the next normal request.

---

## §11 Updating `docs/PROGRESS.md`

> **Mirror of `CLAUDE.md §6`.**

After **every verified step** (a done-when condition actually passes — not "I wrote it"), update `docs/PROGRESS.md`:

- Update the **Current phase** line.
- Tick the relevant **checkbox**.
- Fill the **Recorded artifacts** table (port, configured providers, default preset, last passing test count).
- Append a **session-log** row: `| 2026-06-14 | Phase N | <change> |` (use the real date).
- Add any escalation to the **Owner's open decisions** checklist.

**The human's manual edits win.** If the human edited a line, do not clobber it — reconcile around it.
