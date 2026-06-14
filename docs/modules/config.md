# module: config (`src/config/`)

**What this module owns:** reading + validating env vars, all Zod schemas (request bodies, the fusion object, the config file), and merging file + env + defaults into a typed `Config`.

> **Read `START_HERE.md` first.** **Canonical facts live in `docs/FACTS.md`** (the env var names + meanings) — **link, don't duplicate.** Cites guardrails **G2** (secrets never leak) and **G3** (cost cap enforced).

---

## Env vars (names are LOCKED)

The authoritative list + meanings is in `docs/FACTS.md`. The names are locked: `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OLLAMA_BASE_URL`, `LMSTUDIO_BASE_URL`, `LLAMACPP_BASE_URL`, `FUSION_DEFAULT_PRESET`, `FUSION_MAX_PANEL_MODELS`, `FUSION_TIMEOUT_MS`, `FUSION_MAX_USD_PER_REQUEST`. `env.ts` validates them with Zod and **never logs their values**.

---

## Config file shape (YAML or JSON)

Authoritative schema: `src/config/schema.ts` (`ConfigFileSchema`); a full example is in
[`config.example.yaml`](../../config.example.yaml). Shape:

```yaml
server:
  port: 3000
providers:                # G8: allow/deny by provider id (deny wins; empty allow = all)
  allow: []
  deny: []
models:                   # named models surfaced by /v1/models, referenceable by id
  - id: cloud-sonnet
    provider: openrouter
    model: anthropic/claude-sonnet-4.5
    # base_url: optional
presets:                  # FREE: tune preset CONTENTS (not the names)
  budget:
    analysis_models: [cloud-gpt, local-qwen]   # ids from `models`, or {provider,model,base_url}
    judge: { provider: openrouter, model: openai/gpt-4o-mini }
    synthesizer: { provider: openrouter, model: openai/gpt-4o-mini }
fusion:                   # G3: a request may LOWER a cap but env FUSION_MAX_USD_PER_REQUEST is the ceiling
  default_preset: quality
  max_panel_models: 8
  timeout_ms: 120000
  max_usd_per_request: null
```

(Field names inside this file are FREE-zone; the schema in `src/config/schema.ts` wins.)

---

## Precedence

**env > config file > built-in defaults.** An explicit request field (e.g. a per-request `max_usd_per_request`) may **lower** a limit but the env cap `FUSION_MAX_USD_PER_REQUEST` is the hard ceiling — it can never be raised by file or request. (G3)

---

## Redaction

When config is dumped (startup log, `/health` debug, errors), credentials are redacted: `*_API_KEY`, `Authorization`, and any credentials embedded in a `base_url`. Redaction is the logger's job (`src/observability/logger.ts`); config never prints raw secret values itself. (G2)

---

## Module do / don'ts

- **Do** validate all env + config with Zod and fail fast on a bad value.
- **Do** treat the env cap as the hard ceiling; requests/files only lower it. (G3)
- **Don't** log or echo a secret value, ever — including inside a config dump. (G2)
- **Don't** rename a locked env var. (it's in the LOCKED zone)

---

## Quick reference: add a config key

1. Decide it's FREE (a new tuning knob) vs LOCKED (a new env-var name or a guardrail-affecting limit → escalate).
2. Add it to the Zod schema in `src/config/schema.ts` with a default.
3. Wire it into the merge in `config.ts` honoring precedence (env > file > default).
4. If it's a secret, add it to the redaction allow-list. (G2)
5. Add a `config.test.ts` case; update `docs/PROGRESS.md`.
