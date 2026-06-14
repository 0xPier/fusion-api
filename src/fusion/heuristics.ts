import type { ChatMessage } from "../providers/base.js";
import type { FusionMode } from "./types.js";

/**
 * Auto-mode routing (guardrail G7): a PURE function, no model call, no I/O, no
 * randomness. It scores the user text against versioned keyword tables and
 * returns the matched signals so the decision is explainable in fusion_metadata.
 */
export const HEURISTIC_VERSION = "2026-06-14";

/** Intent signals that make fusion worth the extra cost. */
export const FUSION_TRIGGERS: readonly string[] = [
  "audit",
  "security review",
  "security audit",
  "vulnerabilit",
  "adversarial",
  "threat model",
  "attack",
  "compare",
  "comparison",
  "trade-off",
  "tradeoff",
  "decide between",
  "which option",
  "pros and cons",
  "research",
  "investigate",
  "legal",
  "medical",
  "financial",
  "compliance",
  "architecture",
  "system design",
  "protocol design",
  "tokenomics",
  "smart contract",
  "double check",
  "double-check",
  "find flaws",
  "find bugs",
  "failure mode",
  "edge case",
  "critique",
  "evaluate",
  "high confidence",
  "high-stakes",
  "complex reasoning",
  "reason carefully",
  "rigorous",
];

/** Signals that fusion is overkill — a single model is fine (and cheaper). */
export const FUSION_SUPPRESSORS: readonly string[] = [
  "grammar",
  "spelling",
  "typo",
  "rewrite",
  "reword",
  "rephrase",
  "paraphrase",
  "reformat",
  "formatting",
  "punctuation",
  "capitalize",
  "translate",
  "tldr",
  "shorten",
];

export interface RoutingDecision {
  fusion: boolean;
  reason: string;
  matched: string[];
  suppressed: string[];
}

function userText(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n")
    .toLowerCase();
}

function findTerms(text: string, terms: readonly string[]): string[] {
  const hits: string[] = [];
  for (const term of terms) {
    // word-boundary-ish: require the term to be delimited by non-word chars
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}`, "i");
    if (re.test(text)) hits.push(term);
  }
  return [...new Set(hits)];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Decide whether to run fusion. Explicit `forced`/`off` short-circuit. In
 * `auto`, suppressors are weighed against triggers; triggers win ties so a
 * genuinely complex task still fuses even if it mentions "rewrite".
 */
export function decideMode(messages: ChatMessage[], mode: FusionMode): RoutingDecision {
  if (mode === "forced") {
    return { fusion: true, reason: "mode=forced", matched: [], suppressed: [] };
  }
  if (mode === "off") {
    return { fusion: false, reason: "mode=off", matched: [], suppressed: [] };
  }

  const text = userText(messages);
  const matched = findTerms(text, FUSION_TRIGGERS);
  const suppressed = findTerms(text, FUSION_SUPPRESSORS);

  if (matched.length === 0) {
    const why =
      suppressed.length > 0
        ? `editing/formatting task (${suppressed.join(", ")})`
        : "no high-stakes signals";
    return { fusion: false, reason: `auto: ${why}`, matched, suppressed };
  }

  const fusion = matched.length >= suppressed.length;
  const reason = fusion
    ? `auto: high-stakes signals (${matched.join(", ")})`
    : `auto: editing intent outweighs signals (${suppressed.join(", ")})`;
  return { fusion, reason, matched, suppressed };
}
