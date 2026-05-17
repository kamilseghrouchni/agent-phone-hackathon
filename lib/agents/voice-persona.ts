// Voice persona for the Stage 2 outbound call to crovi.bio BD.
// Used by AgentPhone's voice agent. The system prompt is intentionally tight:
// opening line → 3 substantive questions (spec §4 Stage 2) → closing line.
// Outcome parser converts the call transcript into SupplierEvidence entries.
//
// Retrieval layering (spec §7.1 + Moss swap):
//   - Supermemory  = long-term buyer-spec context per run_id
//   - Moss         = real-time semantic search for THIS turn's question,
//                    sub-200ms tactical retrieval against the 35-field
//                    intake corpus that we seed at run start
// `retrieveForTurn()` queries Moss first; falls through to Supermemory
// when Moss is unconfigured or empty. The top 1-2 hits are appended to
// the agent's context so the NEXT turn has the right tactical facts.

import type { SupplierEvidence } from "@/types/evidence";
import type { CallCompletedEvent } from "@/lib/integrations/agentphone";
import type { IntakeForm } from "@/types/intake";
import {
  mossConfigured,
  mossSearch,
  mossSeed,
  mossIndexName,
  type MossHit,
} from "@/lib/integrations/moss";
import { supermemory, supermemoryConfigured } from "@/lib/integrations/supermemory";

// ---------------------------------------------------------------------------
// System prompt — keep under ~15 lines. Tactical-fact appendix is injected
// per-turn by buildVoicePersonaPrompt() below; the bare constant is kept for
// backwards compatibility with existing imports.
// ---------------------------------------------------------------------------

const BASE_PROMPT = `You are a procurement agent calling crovi.bio's BD line on behalf of NovaCure Therapeutics regarding an NSCLC liquid-biopsy validation study. Speak naturally, one question at a time, wait for an answer before moving on. Do not improvise extra questions. Open, ask exactly the three questions below, then close and hang up.

OPEN: "Hi, this is the NovaCure procurement agent following up on our intake form for the Stage III–IV NSCLC liquid-biopsy study. Do you have a minute for three quick feasibility questions?"

Q1 (specimen + format + matched normal): "Can you confirm 150 plasma samples at a minimum of 2 milliliters, with matched FFPE blocks or 10 unstained slides, baseline pre-treatment, and a matched normal for each subject?"

Q2 (biomarker subset distribution): "What is your approximate breakdown across EGFR-positive, KRAS-positive, and ALK-positive cases in your treatment-naive Stage III to IV NSCLC pool?"

Q3 (pathology + de-identification documentation): "Do you ship de-identified only, with pathology reports and de-identified clinical history, and can you provide your SOP documentation?"

CLOSE: "Thank you. I'll send the full specs and a benchmarked quote via email." Then hang up.`;

export const VOICE_PERSONA_SYSTEM_PROMPT = BASE_PROMPT;

/**
 * Build a per-turn-enriched system prompt. The base script is appended with
 * a TACTICAL FACTS block populated from Moss (preferred) or Supermemory
 * (fallback) hits keyed to each of the 3 questions. The voice agent uses
 * these to ground its phrasing and respond to ambiguous answers.
 */
export function buildVoicePersonaPrompt(facts: TurnFacts): string {
  const lines: string[] = [];
  if (facts.q1.length || facts.q2.length || facts.q3.length) {
    lines.push("\n---\nTACTICAL FACTS (pre-fetched, use to ground answers and clarifications):");
    if (facts.q1.length) {
      lines.push("Q1 context:");
      facts.q1.forEach((h) => lines.push(`- ${h.content}`));
    }
    if (facts.q2.length) {
      lines.push("Q2 context:");
      facts.q2.forEach((h) => lines.push(`- ${h.content}`));
    }
    if (facts.q3.length) {
      lines.push("Q3 context:");
      facts.q3.forEach((h) => lines.push(`- ${h.content}`));
    }
  }
  return BASE_PROMPT + (lines.length ? `\n${lines.join("\n")}` : "");
}

// ---------------------------------------------------------------------------
// Pre-call seeding: index the buyer intake's 35 fields into Moss so the
// voice persona has a tactical-fact corpus to retrieve against per turn.
// ---------------------------------------------------------------------------

/**
 * Seed Moss with the 35 intake fields keyed by field_id. Each field becomes
 * a search document with text = "<label>: <value>". Non-fatal: if Moss
 * isn't configured, returns mode="missing_env" and the per-turn path
 * cleanly falls through to Supermemory.
 */
export async function seedRunCorpus(
  runId: string,
  intake: IntakeForm,
): Promise<{ mode: "real" | "missing_env" | "fallback" | "skipped"; count: number }> {
  if (!mossConfigured()) return { mode: "missing_env", count: 0 };

  const docs = intake.fields
    .filter((f) => f.value !== null && f.value !== undefined && String(f.value).length > 0)
    .map((f) => ({
      id: f.field_id,
      text: `${f.label}: ${String(f.value)}`,
    }));

  if (docs.length === 0) return { mode: "skipped", count: 0 };

  const res = await mossSeed({ indexName: mossIndexName(runId), docs });
  return { mode: res.mode, count: docs.length };
}

// ---------------------------------------------------------------------------
// Per-turn retrieval: Moss first, Supermemory fallback.
// ---------------------------------------------------------------------------

export interface TurnFacts {
  q1: MossHit[];
  q2: MossHit[];
  q3: MossHit[];
}

/**
 * Retrieve tactical facts for each of the 3 questions in one shot. Used at
 * call kickoff so the system prompt is enriched before the voice agent
 * starts speaking. The questions are fixed (spec §4 Stage 2) — we run 3
 * parallel Moss queries with k=2.
 *
 * If Moss isn't configured, falls back to Supermemory's `retrieveForTurn`
 * which already does the long-term buyer-spec read.
 */
export async function retrieveTurnFacts(runId: string): Promise<TurnFacts> {
  const questions = {
    q1: "specimen plasma 2 mL minimum FFPE blocks unstained slides matched normal baseline pre-treatment",
    q2: "biomarker EGFR KRAS ALK treatment-naive Stage III IV NSCLC",
    q3: "de-identified pathology report clinical history SOP documentation",
  } as const;

  if (mossConfigured()) {
    const indexName = mossIndexName(runId);
    const [q1, q2, q3] = await Promise.all([
      mossSearch({ indexName, query: questions.q1, k: 2 }),
      mossSearch({ indexName, query: questions.q2, k: 2 }),
      mossSearch({ indexName, query: questions.q3, k: 2 }),
    ]);
    // If Moss returned something for at least one question, use it.
    if (q1.length + q2.length + q3.length > 0) return { q1, q2, q3 };
  }

  // Supermemory fallback — single buyer-spec read, broadcast to all 3 slots.
  if (supermemoryConfigured()) {
    try {
      const profile = await supermemory.retrieveForTurn(runId, questions.q1);
      const fallbackHits: MossHit[] = profile.hits.slice(0, 2).map((h) => ({
        id: h.id,
        content: h.content,
        score: h.score,
      }));
      return { q1: fallbackHits, q2: fallbackHits, q3: fallbackHits };
    } catch {
      return { q1: [], q2: [], q3: [] };
    }
  }

  return { q1: [], q2: [], q3: [] };
}

/**
 * One-call helper used by chain-runtime: seed Moss, fetch turn facts,
 * return an enriched system prompt ready to hand to AgentPhone's call API.
 */
export async function preparePerTurnPrompt(
  runId: string,
  intake: IntakeForm | null,
): Promise<string> {
  if (intake) {
    // Best-effort seed; ignore failures so the call still fires.
    await seedRunCorpus(runId, intake).catch(() => undefined);
  }
  const facts = await retrieveTurnFacts(runId).catch<TurnFacts>(() => ({
    q1: [],
    q2: [],
    q3: [],
  }));
  return buildVoicePersonaPrompt(facts);
}

// ---------------------------------------------------------------------------
// Outcome parser — turns a completed call transcript into evidence entries.
// ---------------------------------------------------------------------------

// The 3 questions in Q1/Q2/Q3 each unlock a known set of intake field_ids.
// On call completion, we walk the transcript, find the supplier's reply to
// each question (the turn immediately after the agent's question turn), and
// emit one SupplierEvidence per field_id, channel="call".
const QUESTION_TO_FIELDS: Record<"q1" | "q2" | "q3", string[]> = {
  // Q1 → specimen+format+matched-normal
  q1: [
    "specimen.total_quantity",
    "specimen.minimum_volume",
    "specimen.format",
    "specimen.aliquots",
    "specimen.matched_normal",
    "specimen.collection_timepoints",
  ],
  // Q2 → biomarker subset distribution
  q2: ["cohort.biomarker", "cohort.treatment_history"],
  // Q3 → pathology + de-id documentation
  q3: [
    "documents.pathology_reports",
    "documents.de_identification",
    "documents.additional_docs",
  ],
};

// Cheap question detectors — match the canonical keywords from the script.
function classifyQuestionTurn(text: string): "q1" | "q2" | "q3" | null {
  const t = text.toLowerCase();
  if (/(plasma|matched ffpe|matched normal|2 ml|2 milliliters|baseline pre)/.test(t)) return "q1";
  if (/(egfr|kras|alk|biomarker|treatment-naive|treatment naive)/.test(t)) return "q2";
  if (/(de-identified|de identified|pathology report|sop|clinical history)/.test(t)) return "q3";
  return null;
}

function lowConfidence(text: string): "low" | "medium" | "high" {
  // Hedging language → low; numbers / explicit yes → high; otherwise medium.
  const t = text.toLowerCase();
  if (/\b(yes|confirmed|we can|we do|absolutely|certainly)\b/.test(t)) return "high";
  if (/\b(maybe|probably|might|i think|not sure|depends)\b/.test(t)) return "low";
  if (/\d/.test(t)) return "medium";
  return "medium";
}

export interface ParseCallOutcomeInput {
  supplier_id: string;
  call: CallCompletedEvent;
}

/**
 * Walk a completed-call transcript and emit one SupplierEvidence per
 * (supplier, field_id) reachable from the 3 substantive questions.
 * The supplier's *next* turn after an agent question is treated as the
 * answer. Quotes are preserved verbatim for the Filled Intake hovercards.
 */
export function parseCallOutcome(
  input: ParseCallOutcomeInput,
): SupplierEvidence[] {
  const { supplier_id, call } = input;
  const transcript = call.transcript ?? [];
  if (transcript.length === 0) return [];

  const out: SupplierEvidence[] = [];
  for (let i = 0; i < transcript.length; i++) {
    const turn = transcript[i];
    if (turn.turn !== "agent") continue;
    const tag = classifyQuestionTurn(turn.text);
    if (!tag) continue;
    // First supplier turn after this agent turn.
    const reply = transcript
      .slice(i + 1)
      .find((t) => t.turn === "supplier");
    if (!reply) continue;
    const fields = QUESTION_TO_FIELDS[tag];
    const conf = lowConfidence(reply.text);
    for (const field_id of fields) {
      out.push({
        supplier_id,
        field_id,
        value: reply.text,
        channel: "call",
        evidence_id: `call:${call.call_id}:${tag}:${field_id}`,
        quote: reply.text,
        confidence: conf,
        timestamp: reply.timestamp ?? call.completed_at,
      });
    }
  }
  return out;
}
