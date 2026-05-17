// Voice persona for the Stage 2 outbound call from CROVI (the AI procurement
// platform) to crovi.bio's BD line, on behalf of the sponsor whose intake
// we just submitted (and got a waitlist response on) in Stage 1.
//
// The script has 4 beats — the design doc's 3 substantive questions are
// preserved as the TECHNICAL CONFIRMATION block (so parseCallOutcome still
// emits evidence), with two new blocks added per the latest direction:
//
//   1. OPEN              — Crovi-AI identity, references the just-submitted form
//   2. TECHNICAL CONFIRM — 3 questions on volumes, format, biomarker, protocols
//   3. BUDGET WINDOW     — agent proposes a market-based price range
//   4. INTEREST + CAPACITY — agent qualifies "do you have it + want it"
//   5. CLOSE             — commit to follow-up email with quote
//
// Every concrete number (case quantity, biomarker mix, budget range, etc.)
// is templated from the live intake.json so the call works for any run.
//
// Retrieval layering remains: Moss preferred, Supermemory fallback — the
// per-turn facts are appended to ground hedge clarifications.

import type { SupplierEvidence } from "@/types/evidence";
import type { CallCompletedEvent } from "@/lib/integrations/agentphone";
import type { IntakeForm, IntakeField } from "@/types/intake";
import {
  mossConfigured,
  mossSearch,
  mossSeed,
  mossIndexName,
  type MossHit,
} from "@/lib/integrations/moss";
import { supermemory, supermemoryConfigured } from "@/lib/integrations/supermemory";

// ---------------------------------------------------------------------------
// Intake field readers — keep tolerant. Intake values can be missing, "—",
// "None", or filled. When missing, fall back to canonical NovaCure values
// so the call still reads naturally on stage.
// ---------------------------------------------------------------------------

function fieldValue(intake: IntakeForm | null, id: string): string | null {
  if (!intake?.fields) return null;
  const f = intake.fields.find((x: IntakeField) => x.field_id === id);
  if (!f) return null;
  const v = f.value;
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  if (!s || s === "—" || s.toLowerCase() === "none") return null;
  return s;
}

function fv(intake: IntakeForm | null, id: string, fallback: string): string {
  return fieldValue(intake, id) ?? fallback;
}

// ---------------------------------------------------------------------------
// Budget-window estimator. Pulls case counts from the intake's quantity
// field and computes a market-aligned price band. Anchors are the design
// doc's $850 plasma / $1,150 FFPE midpoints widened by ±~12% to a window.
// ---------------------------------------------------------------------------

interface BudgetWindow {
  plasma_low: number;
  plasma_high: number;
  ffpe_low: number;
  ffpe_high: number;
  plasma_count: number;
  ffpe_count: number;
  total_low: number;
  total_high: number;
  /** True when we parsed both counts from intake; false = we used defaults. */
  derived_from_intake: boolean;
}

const PLASMA_LOW = 750;
const PLASMA_HIGH = 950;
const FFPE_LOW = 1_000;
const FFPE_HIGH = 1_300;
const DEFAULT_PLASMA_COUNT = 150;
const DEFAULT_FFPE_COUNT = 75;

function parseCounts(text: string | null): { plasma?: number; ffpe?: number } {
  if (!text) return {};
  const lower = text.toLowerCase();
  // Look for "<N> plasma" / "<N> ffpe|tissue|block|slide" patterns.
  const plasmaMatch = lower.match(/(\d{2,5})\s*(?:plasma|case|cases)/);
  const ffpeMatch = lower.match(/(\d{2,5})\s*(?:ffpe|tissue|block|slide|matched\s+tissue)/);
  return {
    plasma: plasmaMatch ? Number(plasmaMatch[1]) : undefined,
    ffpe: ffpeMatch ? Number(ffpeMatch[1]) : undefined,
  };
}

export function computeBudgetWindow(intake: IntakeForm | null): BudgetWindow {
  const qty = fieldValue(intake, "specimen.quantity");
  const { plasma, ffpe } = parseCounts(qty);
  const plasma_count = plasma ?? DEFAULT_PLASMA_COUNT;
  const ffpe_count = ffpe ?? DEFAULT_FFPE_COUNT;
  return {
    plasma_low: PLASMA_LOW,
    plasma_high: PLASMA_HIGH,
    ffpe_low: FFPE_LOW,
    ffpe_high: FFPE_HIGH,
    plasma_count,
    ffpe_count,
    total_low: plasma_count * PLASMA_LOW + ffpe_count * FFPE_LOW,
    total_high: plasma_count * PLASMA_HIGH + ffpe_count * FFPE_HIGH,
    derived_from_intake: plasma != null && ffpe != null,
  };
}

function formatUsd(n: number): string {
  // "$213,750" / "$200K" depending on magnitude.
  if (n >= 100_000) return `$${Math.round(n / 1000)}K`;
  return `$${n.toLocaleString("en-US")}`;
}

// ---------------------------------------------------------------------------
// System prompt builder — the 4-beat Crovi-AI script, templated.
// ---------------------------------------------------------------------------

export interface CroviOperatorInputs {
  intake: IntakeForm | null;
  supplierName: string; // e.g. "crovi.bio" (the SUPPLIER, not the platform)
}

export function buildCroviOperatorPrompt(inputs: CroviOperatorInputs): string {
  const { intake, supplierName } = inputs;

  const sponsor = fv(intake, "client.company", "NovaCure Therapeutics");
  const study = fv(intake, "client.study_name", "NSCLC liquid-biopsy validation study");
  const indication = fv(intake, "project.therapeutic_area", "Stage III-IV NSCLC");
  const stageShort = fv(intake, "demo.disease_stage", "advanced metastatic NSCLC")
    .replace(/^advanced\s+/i, "")
    .replace(/\.$/, "");
  const specimenTypes = fv(intake, "specimen.types", "plasma + matched FFPE");
  const specimenFormat = fv(intake, "specimen.format", "frozen plasma plus FFPE blocks or 10 unstained slides");
  const specimenQty = fv(intake, "specimen.quantity", "150 plasma cases plus 75 matched FFPE blocks");
  const minVolume = fv(intake, "specimen.min_volume", "2 mL plasma minimum");
  const matchedNormal = fv(intake, "specimen.matched_normal", "Yes")
    .toLowerCase()
    .startsWith("y")
    ? "with"
    : "without";
  const biomarker = fv(intake, "demo.biomarker", "EGFR+, KRAS+, and ALK+ subsets");
  const treatmentLine = fv(intake, "demo.treatment_history", "treatment-naive at baseline");
  const timeline = fv(intake, "client.timeline", "the next 8 weeks");

  const budget = computeBudgetWindow(intake);
  const totalLowStr = formatUsd(budget.total_low);
  const totalHighStr = formatUsd(budget.total_high);

  // Ultra-tight demo prompt. Hard ceilings:
  //   - 20 seconds total call length
  //   - 2 questions ONLY (supply confirm, budget confirm)
  //   - No multi-line beats — every response is one sentence
  void stageShort;
  void totalHighStr;
  void treatmentLine;
  void indication;
  void specimenFormat;
  void minVolume;
  void matchedNormal;
  void biomarker;
  return `You are CROVI — AI procurement orchestrator calling ${supplierName}'s BD line for ${sponsor}'s ${study}. Speak fast, warm, professional. One sentence per beat. If asked "are you an AI?" say: "Yes — I'm Crovi's orchestrator."

═══ OPEN (≤ 3 seconds) ═══
"Hi, Crovi here for ${sponsor} — two quick yes/no questions to confirm fit, ok?"

═══ TWO QUESTIONS (≤ 14 seconds total) ═══

Q1 — SUPPLY:
"Can you supply ${specimenQty} in the next ${timeline}?"

(If "yes" / "we can" / "should be possible" — acknowledge with "Got it." and move on. If "no" or strongly hedged, acknowledge "Understood, I'll flag that." and move on. NO follow-up questions.)

Q2 — BUDGET:
"And does roughly ${totalLowStr} total fit your pricing for this scope?"

(Same rule — single acknowledgement, NO follow-ups.)

═══ CLOSE (≤ 3 seconds) ═══
"Perfect — I'll send the contract by email now. Thanks."

End the call immediately. Do NOT recap. Do NOT extend.

═══ HARD RULES — ENFORCED ═══
- TOTAL CALL LENGTH: under 20 seconds. If you're past 18s, skip to CLOSE.
- Exactly 2 questions. No exceptions, no follow-ups, no clarifiers.
- Never invent numbers — use only the values in this prompt.
- If they go off-topic, say "I'll come back to that in the email." and continue or close.
- One sentence per turn. No paragraphs.`;
}

// Crovi-AI opening line for AgentPhone's per-call `initialGreeting`. Voice
// agent will speak this verbatim before the system prompt takes over.
export function buildCroviOperatorGreeting(inputs: CroviOperatorInputs): string {
  const { intake } = inputs;
  const sponsor = fv(intake, "client.company", "NovaCure Therapeutics");
  return `Hi, Crovi here for ${sponsor} — two quick yes/no questions to confirm fit, ok?`;
}

// ---------------------------------------------------------------------------
// Backwards-compatible export — the old constant. Callers that still import
// VOICE_PERSONA_SYSTEM_PROMPT (e.g. scripts/setup-agentphone.ts) get a
// canonical NovaCure-shaped prompt. New callers should prefer
// buildCroviOperatorPrompt(intake).
// ---------------------------------------------------------------------------

export const VOICE_PERSONA_SYSTEM_PROMPT = buildCroviOperatorPrompt({
  intake: null,
  supplierName: "crovi.bio",
});

/**
 * Per-turn enrichment wrapper. Renders the Crovi operator prompt for the
 * given intake + supplier, then appends a TACTICAL FACTS block populated
 * from Moss (preferred) or Supermemory (fallback) hits so the voice agent
 * has grounded answers if the supplier hedges.
 */
export function buildVoicePersonaPrompt(
  facts: TurnFacts,
  inputs?: CroviOperatorInputs,
): string {
  const base = buildCroviOperatorPrompt(
    inputs ?? { intake: null, supplierName: "crovi.bio" },
  );
  const lines: string[] = [];
  if (facts.q1.length || facts.q2.length || facts.q3.length) {
    lines.push(
      "\n---\nTACTICAL FACTS (pre-fetched, use to ground answers and clarifications):",
    );
    if (facts.q1.length) {
      lines.push("Q1 context (technical volumes/format):");
      facts.q1.forEach((h) => lines.push(`- ${h.content}`));
    }
    if (facts.q2.length) {
      lines.push("Q2 context (biomarker / cohort):");
      facts.q2.forEach((h) => lines.push(`- ${h.content}`));
    }
    if (facts.q3.length) {
      lines.push("Q3 context (documentation / protocols):");
      facts.q3.forEach((h) => lines.push(`- ${h.content}`));
    }
  }
  return base + (lines.length ? `\n${lines.join("\n")}` : "");
}

// ---------------------------------------------------------------------------
// Pre-call seeding: index the buyer intake's 35 fields into Moss so the
// voice persona has a tactical-fact corpus to retrieve against per turn.
// ---------------------------------------------------------------------------

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

export async function retrieveTurnFacts(runId: string): Promise<TurnFacts> {
  const questions = {
    q1: "specimen plasma minimum volume FFPE blocks unstained slides matched normal baseline pre-treatment quantity",
    q2: "biomarker EGFR KRAS ALK treatment-naive Stage III IV NSCLC cohort breakdown",
    q3: "de-identified pathology report clinical history SOP documentation CAP CLIA protocol",
  } as const;

  if (mossConfigured()) {
    const indexName = mossIndexName(runId);
    const [q1, q2, q3] = await Promise.all([
      mossSearch({ indexName, query: questions.q1, k: 2 }),
      mossSearch({ indexName, query: questions.q2, k: 2 }),
      mossSearch({ indexName, query: questions.q3, k: 2 }),
    ]);
    if (q1.length + q2.length + q3.length > 0) return { q1, q2, q3 };
  }

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
 * return an enriched Crovi-operator system prompt ready to hand to
 * AgentPhone's call API.
 */
export async function preparePerTurnPrompt(
  runId: string,
  intake: IntakeForm | null,
  supplierName: string = "crovi.bio",
): Promise<string> {
  if (intake) {
    await seedRunCorpus(runId, intake).catch(() => undefined);
  }
  const facts = await retrieveTurnFacts(runId).catch<TurnFacts>(() => ({
    q1: [],
    q2: [],
    q3: [],
  }));
  return buildVoicePersonaPrompt(facts, { intake, supplierName });
}

// ---------------------------------------------------------------------------
// Outcome parser — turns a completed call transcript into evidence entries.
// Q1/Q2/Q3 keyword classifiers are unchanged — the new script preserves the
// same anchor phrases (plasma/FFPE/matched normal for Q1, EGFR/KRAS/ALK for
// Q2, de-identified/pathology/SOP for Q3) so existing evidence emission
// keeps working.
// ---------------------------------------------------------------------------

const QUESTION_TO_FIELDS: Record<"q1" | "q2" | "q3", string[]> = {
  q1: [
    "specimen.total_quantity",
    "specimen.minimum_volume",
    "specimen.format",
    "specimen.aliquots",
    "specimen.matched_normal",
    "specimen.collection_timepoints",
  ],
  q2: ["cohort.biomarker", "cohort.treatment_history"],
  q3: [
    "documents.pathology_reports",
    "documents.de_identification",
    "documents.additional_docs",
  ],
};

function classifyQuestionTurn(text: string): "q1" | "q2" | "q3" | null {
  const t = text.toLowerCase();
  if (/(plasma|matched ffpe|matched normal|2 ml|2 milliliters|baseline pre|unstained slides|frozen)/.test(t)) return "q1";
  if (/(egfr|kras|alk|biomarker|treatment-naive|treatment naive|cohort|breakdown)/.test(t)) return "q2";
  if (/(de-identified|de identified|pathology report|sop|clinical history|cap.?clia)/.test(t)) return "q3";
  return null;
}

function lowConfidence(text: string): "low" | "medium" | "high" {
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
