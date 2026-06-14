/**
 * Deterministic JSON repair (rung 3 of the judge ladder). PURE — no model call.
 * Every transform is individually unit-testable.
 */

/** Strip ```json … ``` / ``` … ``` fences and surrounding whitespace. */
export function stripCodeFences(text: string): string {
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/m.exec(text);
  if (fence) return fence[1].trim();
  return text.trim();
}

/** Extract the first balanced {…} object, ignoring braces inside strings. */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Remove trailing commas before } or ]. */
export function removeTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, "$1");
}

/** Normalize curly/smart quotes to straight quotes. */
export function normalizeSmartQuotes(text: string): string {
  return text.replace(/[“”„‟]/g, '"').replace(/[‘’‚‛]/g, "'");
}

/**
 * Full deterministic repair pipeline. Returns the parsed object, or null if it
 * still cannot be parsed (caller then uses the structured fallback).
 */
export function deterministicRepair(raw: string): unknown | null {
  const candidates: string[] = [];
  const defenced = stripCodeFences(raw);
  candidates.push(defenced);
  const extracted = extractFirstJsonObject(defenced) ?? extractFirstJsonObject(raw);
  if (extracted) {
    candidates.push(extracted);
    candidates.push(normalizeSmartQuotes(removeTrailingCommas(extracted)));
  }
  candidates.push(normalizeSmartQuotes(removeTrailingCommas(defenced)));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }
  return null;
}

/** Plain parse with fence-stripping (rung 1, before validation). */
export function tryParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(stripCodeFences(raw));
  } catch {
    return null;
  }
}
