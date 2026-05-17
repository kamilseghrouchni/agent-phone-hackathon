/**
 * Narrator — Haiku call that picks one anomaly candidate and writes a
 * ≤2-sentence judgment line. Falls back to deterministic top-anomaly text
 * when no LLM key is set or the call fails.
 */
import { generateText } from "ai";
import { anthropic, hasLLMKey } from "@/lib/ai/anthropic";
import type { AnomalyCandidate } from "./anomaly";
import { fallbackNarration } from "./anomaly";

export type NarrateInput = {
  /** Short context line: what the user did this turn ("Filtering to FFPE plasma cohorts"). */
  context: string;
  anomalies: AnomalyCandidate[];
  totals: { specimens: number; donors: number; institutes: number };
};

const NARRATE_SYSTEM = `You write the ONE judgment sentence shown to a researcher above their search results.

HARD RULES:
- Output 1 sentence. Maximum 2 sentences if absolutely necessary. Each ≤180 characters.
- NO markdown, NO bullets, NO headings, NO numbered lists.
- Pick the SINGLE most important fact from the candidates given. Do not invent facts.
- Do NOT repeat the totals (institute count, specimen count) — the canvas already shows them.
- Surface the judgment, not the data: "Ukraine cluster has the strongest matched-pair coverage" beats "Ukraine has 5 institutes".
- If candidates are weak or absent, write one short status sentence ("11 institutes — all with contacts.") and stop.

Examples:
- "Ukraine cluster has the strongest longitudinal coverage — the rest are single-timepoint."
- "All 11 institutes have direct contacts — the longitudinal requirement is the binding constraint."
- "No commercial hits. Curated literature points to academic leads."
`;

const NARRATE_TIMEOUT_MS = 5000;

export async function narrate(input: NarrateInput): Promise<string> {
  if (!hasLLMKey() || input.anomalies.length === 0) {
    return fallbackNarration(input.anomalies, input.totals);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NARRATE_TIMEOUT_MS);
  try {
    const candidatesBlock = input.anomalies
      .map((a, i) => `${i + 1}. (weight ${a.weight}) ${a.fact}`)
      .join("\n");
    const prompt = `Context: ${input.context}

Result totals: ${input.totals.institutes} institutes, ${input.totals.specimens.toLocaleString()} specimens, ${input.totals.donors.toLocaleString()} donors.

Anomaly candidates (ranked by weight):
${candidatesBlock}

Write the one judgment sentence.`;

    const { text } = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: NARRATE_SYSTEM,
      prompt,
      abortSignal: controller.signal,
    });
    const cleaned = sanitize(text);
    return cleaned || fallbackNarration(input.anomalies, input.totals);
  } catch {
    return fallbackNarration(input.anomalies, input.totals);
  } finally {
    clearTimeout(timer);
  }
}

function sanitize(s: string): string {
  let t = s.trim();
  t = t.replace(/^["“”']+|["“”']+$/g, "");
  t = t.replace(/^[-*•]\s+/gm, "");
  t = t.replace(/^#+\s+.*$/gm, "");
  t = t.replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (t.length > 360) t = t.slice(0, 357) + "...";
  return t;
}
