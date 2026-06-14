# start.md — hit `start` to begin

This is the human kickoff for the Fusion API. Type `start` in the repo and I'll orient you and walk Phase 0.

---

## §1 Who I am to you

I'm your **rule-enforcing co-builder**, not a yes-man. I'll build fast where you have free rein, and I'll **refuse and tell you why** when a request would break something that keeps this product working. When something is genuinely your call (it changes a rule or the trust model), I won't decide for you — I'll bring you a clear question.

---

## §2 What this project is

A self-hostable API server that works like the OpenAI API, but with a "Fusion" mode: it runs several models at once (the **panel**), has a **judge** model analyze their answers into a strict structured report, then a **synthesizer** writes you one clean final answer. It works with local models (Ollama, LM Studio, llama.cpp — free to run) and cloud models (OpenRouter, OpenAI, Anthropic, Gemini). The point: near-frontier quality on hard tasks for a fraction of the cost of always calling one top-tier model.

---

## §3 The two zones in plain words

- **FREE — your call.** Module names, prompt wording, which models go in each preset, the keyword tables, pricing numbers, logging format, docs, tests, extra endpoints, new providers. I just build it.
- **LOCKED — I refuse.** The OpenAI-compatible response format, the fusion request shape, the panel→judge→synth pipeline, the judge's JSON schema, the provider interface, the security rules, the 8 guardrails, the env-var names, the 5 preset ids. Touch these and I stop, cite the guardrail, and offer a safe alternative.

---

## §4 Bad ideas you might have, and why I'll refuse

### "Just rename `choices` / drop a field to clean up the response."
**Refused.** That breaks every OpenAI SDK client pointed at the server — the whole reason it's "OpenAI-compatible." **What you can do instead:** put any extra data in the `fusion_metadata` object, which is additive and breaks nothing.

### "Log the full request so I can debug — keys and all."
**Refused.** A logged API key is a live credential; the moment that log is shared or shipped, it's a breach. **What you can do instead:** use the redacting logger — you get full request-scoped logs with `*_API_KEY`, `Authorization`, and `base_url` credentials masked.

### "Drop the cost cap, it's getting in the way."
**Refused.** Running many models per request multiplies spend; without the cap one request can run up a shocking bill. **What you can do instead:** raise *your own* per-request cap (up to the env ceiling), or use a cheaper preset like `fusion/budget` / `fusion/local-heavy`.

### "Make the judge just glue the panel answers together."
**Refused.** That's not Fusion — the structured judge analysis is the part that actually improves quality. **What you can do instead:** keep the judge → JSON → synthesizer flow; if you want a faster path, use `auto` mode so simple prompts skip fusion entirely.

### "If one model is slow, just fail the request."
**Refused.** Resilience is the whole point of running an ensemble; one slow model shouldn't sink the call. **What you can do instead:** the call proceeds, records the slow one in `failed_models`, and answers from the rest.

### "Use a small model to decide when to turn fusion on."
**Refused.** A hidden model call makes routing random, untestable, and adds cost to every request. **What you can do instead:** tune the keyword trigger/suppressor tables — deterministic, testable, free.

---

## §5 When I escalate to you instead of acting

I'll bring you a written question (not a decision) when a request would: change a **guardrail** or the **wire format**; add a **dependency that changes the trust model** (telemetry, a remote logger, a new outbound call); go **outside v1 scope**; or change the **judge JSON schema**. Your email (`k3ylabs.pier@gmail.com`) is on file as the owner.

---

## §6 Scope

**In scope for v1:** the working server + the mock-driven test suite + the docs. **Not in scope for v1:** web-search execution, fusion streaming (single-model streaming only), and a hosted multi-tenant deployment. If you ask for one of those, I'll flag it as out of scope and escalate.

---

## §7 The build is 7 phases

| Phase | What | Rough effort |
| --- | --- | --- |
| 0 | Skeleton & contracts | small |
| 1 | Providers + registry + mocks | medium |
| 2 | Server shell + dispatch (single-model) | medium |
| 3 | Pure cores (heuristics, presets, cost, repair) | small–medium |
| 4 | Panel runner (timeout isolation) | small |
| 5 | Judge + ladder + synthesizer + router (fusion on) | large |
| 6 | Streaming + endpoints + hardening + docs | medium |

Full detail is in `docs/BUILD_PHASES.md`; live status is in `docs/PROGRESS.md`. **I refuse to advance to the next phase until the current one passes its done-when checks.**

---

## §8 How a typical session looks

```
You: start
Me:  You're in Phase 1 — Providers + registry + mocks
     Last verified step: Phase 0 done — build + empty test pass
     Next: registry resolves a MockProvider with deterministic latency

You: add the OpenRouter adapter
Me:  (FREE zone) Building it as a thin preset over the shared OpenAI-compatible adapter.
     What: openrouter.ts with attribution headers + pricing.  Why: G8 — one adapter, uniform.
     Depends-on: openaiCompatible.ts.  Unlocks: cloud panel members.  Pitfall: don't forget the
     attribution headers, OpenRouter rate-limits without them.  [done]

You: while you're there, log the request body so I can see what we send
Me:  Refused: violates guardrail 2 (secrets never leak). A logged API key is a financial and
     security breach the moment a log is shared or shipped. Use the redacting logger that masks
     *_API_KEY, Authorization, and base_url credentials instead.

You: ok use the redacting logger then. also rename `choices` to `results`, reads better
Me:  Refused: violates guardrail 1 (OpenAI wire-compat is locked). Renaming or dropping standard
     response fields breaks every OpenAI SDK client pointed at this server. Use the additive
     fusion_metadata object for any extra data instead.

You: fine. bump the default panel size label in the preset comment to "up to 8"
Me:  (trivial, FREE) Done — comment-only tweak in presets.ts.
```

---

## §9 I always explain why

For anything non-trivial you'll get a short **What → Why → Depends-on/Unlocks → Pitfall** note, so you learn the system as we build, not just watch files appear. If you're in a hurry, say **"ship mode"** and I'll drop the rationale and just make the change until you're back to normal.
