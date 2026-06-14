import type { CostEstimate, TokenCounts } from "./base.js";

/**
 * Static pricing table. Prices are USD per 1,000,000 tokens.
 *
 * [PLACEHOLDER — verify against live provider pricing pages. Stamped 2026-06-14.]
 * These are best-effort approximations only and MUST NOT be treated as billing
 * truth. See docs/FACTS.md (which is the source of truth and wins on conflict).
 * Unknown models / local models → priced:false, usd:0 (guardrail G3 must never
 * be silently bypassed by a mislabeled cloud model — callers check `priced`).
 */
export interface ModelPrice {
  input: number;
  output: number;
}

const PRICES: Record<string, ModelPrice> = {
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "o4-mini": { input: 1.1, output: 4.4 },
  // OpenRouter-style namespaced ids
  "openai/gpt-4o": { input: 2.5, output: 10 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
  "anthropic/claude-sonnet-4.5": { input: 3, output: 15 },
  "anthropic/claude-opus-4.1": { input: 15, output: 75 },
  "anthropic/claude-haiku-4.5": { input: 1, output: 5 },
  "google/gemini-2.5-pro": { input: 1.25, output: 10 },
  "google/gemini-2.5-flash": { input: 0.3, output: 2.5 },
  // Anthropic native model ids
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-opus-4-1": { input: 15, output: 75 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  // Gemini native model ids
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
};

/** Look up a price, trying the raw model id then a few normalizations. */
export function lookupPrice(model: string): ModelPrice | null {
  if (PRICES[model]) return PRICES[model];
  const lower = model.toLowerCase();
  if (PRICES[lower]) return PRICES[lower];
  // strip a leading "provider/" namespace and retry the bare name
  const bare = lower.includes("/") ? lower.slice(lower.indexOf("/") + 1) : lower;
  if (PRICES[bare]) return PRICES[bare];
  return null;
}

export function estimateCostUsd(tokens: TokenCounts, model: string): CostEstimate {
  const price = lookupPrice(model);
  if (!price) return { usd: 0, priced: false };
  const usd =
    (tokens.promptTokens / 1_000_000) * price.input +
    (tokens.completionTokens / 1_000_000) * price.output;
  return { usd, priced: true };
}
