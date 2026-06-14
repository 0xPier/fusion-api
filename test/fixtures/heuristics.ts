/** Prompt → expected auto-routing decision. Snapshot set for the heuristic. */
export const HEURISTIC_FIXTURES: Array<{ prompt: string; fusion: boolean; note: string }> = [
  {
    prompt: "Audit this architecture for failure modes",
    fusion: true,
    note: "audit + architecture",
  },
  {
    prompt: "Compare these two protocol designs and decide between them",
    fusion: true,
    note: "compare + decide + protocol",
  },
  {
    prompt: "Do a security review of this smart contract for vulnerabilities",
    fusion: true,
    note: "security review + smart contract",
  },
  {
    prompt: "Research the trade-offs between Postgres and DynamoDB",
    fusion: true,
    note: "research + trade-off",
  },
  { prompt: "Find flaws in my tokenomics model", fusion: true, note: "find flaws + tokenomics" },
  {
    prompt: "Fix the grammar in this sentence: me and him goes to store",
    fusion: false,
    note: "grammar fix",
  },
  { prompt: "Rewrite this paragraph to be shorter", fusion: false, note: "rewrite + shorten" },
  { prompt: "What is the capital of France?", fusion: false, note: "simple factual" },
  { prompt: "hey how is it going today", fusion: false, note: "casual chat" },
  { prompt: "Reformat this JSON with two-space indentation", fusion: false, note: "formatting" },
];
