import type { ChatMessage } from "../providers/base.js";
import type { JudgeAnalysis } from "./types.js";

/** The strict schema we require from the judge, embedded verbatim in its prompt. */
export const JUDGE_JSON_SCHEMA = `{
  "consensus": [],
  "contradictions": [],
  "partial_coverage": [],
  "unique_insights": [],
  "blind_spots": [],
  "likely_errors": [],
  "recommended_answer_plan": [],
  "confidence": { "overall": "low|medium|high", "notes": "" },
  "model_scores": [
    { "model_id": "", "strengths": [], "weaknesses": [], "score": 0 }
  ]
}`;

// ── Panel ──

export const PANEL_SYSTEM_PROMPT = [
  "You are one independent expert on a multi-model analysis panel.",
  "Do not mention other models, the panel, or that this is a multi-model process.",
  "Answer the user's request directly and completely.",
  "Explicitly include your assumptions, risks, uncertainties, and edge cases.",
  "Do not over-polish. Prefer correctness over style.",
].join(" ");

export function buildPanelMessages(messages: ChatMessage[]): ChatMessage[] {
  return [{ role: "system", content: PANEL_SYSTEM_PROMPT }, ...stripSystem(messages)];
}

// ── Judge ──

export const JUDGE_SYSTEM_PROMPT = [
  "You are the judge in a multi-model analysis panel.",
  "Compare the panel answers below. Do NOT write the final answer for the user.",
  "Identify consensus, contradictions, partial coverage, unique insights, blind spots, and likely errors.",
  "Score each model (0-10) with concrete strengths and weaknesses.",
  "Return STRICT JSON ONLY — no prose, no markdown fences — matching exactly this schema:",
  JUDGE_JSON_SCHEMA,
].join("\n");

export interface PanelExcerpt {
  id: string;
  provider: string;
  model: string;
  content: string;
}

export function buildJudgeMessages(messages: ChatMessage[], panel: PanelExcerpt[]): ChatMessage[] {
  const task = renderOriginalTask(messages);
  const answers = panel
    .map(
      (p, i) =>
        `### Panel answer ${i + 1} — model_id: "${p.id}" (provider: ${p.provider}, model: ${p.model})\n${p.content}`,
    )
    .join("\n\n");
  const user = [
    "ORIGINAL USER REQUEST:",
    task,
    "",
    "PANEL ANSWERS:",
    answers,
    "",
    `Use the exact model_id values shown above in "model_scores". Return STRICT JSON only.`,
  ].join("\n");
  return [
    { role: "system", content: JUDGE_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

export function buildRepairMessages(brokenOutput: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "Your previous output was supposed to be strict JSON but could not be parsed.",
        "Return ONLY valid JSON matching exactly this schema, with no prose and no markdown fences:",
        JUDGE_JSON_SCHEMA,
      ].join("\n"),
    },
    { role: "user", content: `Fix this into valid JSON:\n\n${brokenOutput}` },
  ];
}

// ── Synthesizer ──

export const SYNTH_SYSTEM_PROMPT = [
  "You write the final answer for the user, informed by a judge's structured analysis of a panel of expert answers.",
  "Do NOT reveal the hidden deliberation, the panel, the judge, or any raw model debate.",
  "Use the judge's analysis to produce the best possible answer.",
  "Mention uncertainty where the analysis flags it.",
  "Be concise but complete.",
  "Include sources ONLY if real source URLs were provided by tools — never invent citations.",
].join(" ");

export function buildSynthMessages(
  messages: ChatMessage[],
  judge: JudgeAnalysis,
  excerpts: PanelExcerpt[],
): ChatMessage[] {
  const task = renderOriginalTask(messages);
  const judgeJson = JSON.stringify(stripInternal(judge), null, 2);
  const excerptText = excerpts
    .map((p, i) => `### Excerpt ${i + 1} (model_id: ${p.id})\n${truncate(p.content, 1500)}`)
    .join("\n\n");
  const user = [
    "ORIGINAL USER REQUEST:",
    task,
    "",
    "JUDGE ANALYSIS (JSON):",
    judgeJson,
    "",
    "HIGH-VALUE PANEL EXCERPTS:",
    excerptText,
    "",
    "Write the final answer for the user now.",
  ].join("\n");
  return [
    { role: "system", content: SYNTH_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

// ── helpers ──

function stripSystem(messages: ChatMessage[]): ChatMessage[] {
  // Keep the user's own system prompt out of the panel role-prompt collision by
  // demoting it into the conversation as context.
  return messages.map((m) => (m.role === "system" ? { ...m, role: "user" as const } : m));
}

function renderOriginalTask(messages: ChatMessage[]): string {
  return messages.map((m) => `[${m.role}] ${m.content}`).join("\n");
}

function stripInternal(judge: JudgeAnalysis): Omit<JudgeAnalysis, "_fallback"> {
  const { _fallback, ...rest } = judge;
  void _fallback;
  return rest;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
