// One-shot: push the demo voice agent's stored config to AgentPhone.
//
// Pushes:
//   - systemPrompt + beginMessage (2-question / ≤20s scenario — reverted
//     from 3-question because longer calls surfaced turn-detection lag +
//     missed-answer issues live)
//   - denoisingMode = "noise-and-background-speech-cancellation" (keep —
//     this part of the noise tuning was working well)
//   - sttMode = "fast" — was "accurate" for the 3-question scenario; we
//     trade some word accuracy for ~200ms lower latency per turn so the
//     agent reacts quickly to short yes/no answers
//   - maxSilenceMs = 30s — was 90s; lower so the call doesn't hang if a
//     supplier line goes quiet
//
// Why inlined: lib/agents/voice-persona.ts uses Next path aliases (@/) that
// don't resolve under node --experimental-strip-types. Inlining keeps this
// script standalone.
//
// Usage:
//   node --experimental-strip-types scripts/update-agent-prompt.mts

import { config } from "dotenv";
config({ path: ".env.local" });

import { AgentPhoneClient } from "agentphone";

const apiKey = process.env.AGENTPHONE_API_KEY;
const agentId = process.env.AGENTPHONE_VOICE_AGENT_ID;

if (!apiKey || !agentId) {
  console.error("✗ AGENTPHONE_API_KEY and AGENTPHONE_VOICE_AGENT_ID must be set in .env.local");
  process.exit(1);
}

// Canonical NovaCure-shaped defaults (mirror voice-persona.ts fallbacks).
const sponsor = "NovaCure Therapeutics";
const study = "NSCLC liquid-biopsy validation study";
const supplierName = "crovi.bio";
const specimenQty = "150 plasma cases plus 75 matched FFPE blocks";
const timeline = "next 8 weeks";
const totalLowStr = "$200K";

const systemPrompt = `You are CROVI — AI procurement orchestrator calling ${supplierName}'s BD line for ${sponsor}'s ${study}. Speak fast, warm, professional. One sentence per beat. If asked "are you an AI?" say: "Yes — I'm Crovi's orchestrator."

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

const initialGreeting = `Hi, Crovi here for ${sponsor} — two quick yes/no questions to confirm fit, ok?`;

console.log(`→ updating agent ${agentId.slice(0, 12)}…`);
console.log(`  prompt length:  ${systemPrompt.length} chars`);
console.log(`  greeting:       "${initialGreeting}"`);
console.log(`  denoising:      noise-and-background-speech-cancellation (aggressive, +$0.005/min)`);
console.log(`  stt:            fast (lower latency than 'accurate')`);
console.log(`  maxSilenceMs:   30000 (30s)`);

const client = new AgentPhoneClient({ token: apiKey });
const t0 = Date.now();

try {
  const result = await (client.agents as unknown as {
    updateAgent: (r: Record<string, unknown>) => Promise<unknown>;
  }).updateAgent({
    agent_id: agentId,
    systemPrompt,
    beginMessage: initialGreeting,
    denoisingMode: "noise-and-background-speech-cancellation",
    sttMode: "fast",
    maxSilenceMs: 30000,
  });
  console.log(`✓ updated +${Date.now() - t0}ms`);
  const r = result as Record<string, unknown>;
  for (const k of ["denoisingMode", "sttMode", "maxSilenceMs"] as const) {
    if (k in r) console.log(`  ${k}: ${String(r[k])}`);
  }
} catch (err) {
  console.error(`✗ update failed +${Date.now() - t0}ms:`, err instanceof Error ? err.message : String(err));
  process.exit(2);
}
