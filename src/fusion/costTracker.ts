/**
 * Pure accumulator for actual (post-call) cost. No I/O, no clock. Used to gate
 * forward spend mid-pipeline (guardrail G3). Note the ordering reality: a gate
 * only sees money already spent on prior stages — it decides whether to spend
 * the NEXT stage, it cannot refund.
 */
export interface CostEntry {
  stage: string;
  model: string;
  usd: number;
  priced: boolean;
  promptTokens: number;
  completionTokens: number;
}

export class CostTracker {
  private readonly entries: CostEntry[] = [];

  add(entry: CostEntry): void {
    this.entries.push(entry);
  }

  total(): number {
    return this.entries.reduce((sum, e) => sum + e.usd, 0);
  }

  /** True if every cost entry had pricing data (no unpriced cloud models). */
  allPriced(): boolean {
    return this.entries.every((e) => e.priced);
  }

  anyUnpriced(): boolean {
    return this.entries.some((e) => !e.priced);
  }

  /** Would spending `additionalUsd` more exceed the cap? Null cap = no limit. */
  wouldExceed(additionalUsd: number, cap: number | null): boolean {
    if (cap === null) return false;
    return this.total() + additionalUsd > cap;
  }

  list(): readonly CostEntry[] {
    return this.entries;
  }
}
