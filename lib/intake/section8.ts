// lib/intake/section8.ts
// Pure function — computes the §8 NEW agent-filled rows from ChainState.
//
// §8 NEW fields per spec §2: Contract acceptance, Down payment, Meeting confirmed, Status.
// All entries have class: "agent_filled", section: 8, status: "agent_filled".

import type { IntakeField, IntakeForm } from "@/types/intake";
import type { ChainState, ChainStageEvent } from "@/types/chain";

const SECTION_8_FIELD_IDS = {
  contractAcceptance: "section8.contract_acceptance",
  downPayment: "section8.down_payment",
  meetingConfirmed: "section8.meeting_confirmed",
  status: "section8.status",
} as const;

/**
 * Walks a stage's bi-directional thread looking for inbound supplier confirmation.
 * Returns the matched event id for provenance, or undefined.
 */
function findInbound(events: ChainStageEvent[], predicate: (e: ChainStageEvent) => boolean): ChainStageEvent | undefined {
  return events.find((e) => e.direction === "inbound" && predicate(e));
}

/**
 * Pure: derive §8 from ChainState. No I/O.
 */
export function computeSection8(intake: IntakeForm, chain: ChainState): IntakeField[] {
  void intake; // intake is reserved for future cross-checks (e.g. buyer.email match); kept on signature per spec.

  const emailStage = chain.stages.email;
  const smsPayStage = chain.stages.sms_pay;
  const meetingStage = chain.stages.meeting;

  // Contract acceptance — supplier replied "I agree" via email.
  const acceptanceEvent = findInbound(emailStage?.events ?? [], (e) =>
    typeof e.text === "string" && /agree|accept|confirmed/i.test(e.text),
  );
  const contractAcceptance =
    emailStage?.status === "complete" && acceptanceEvent
      ? "Accepted via email reply"
      : emailStage?.status === "in_progress"
        ? "Pending supplier reply"
        : null;

  // Down payment — Sponge stage_pay completed with a transfer (legacy "stripe"
  // events from pre-swap demos still match for back-compat).
  const payActorMatches = (e: ChainStageEvent) => e.actor === "sponge" || e.actor === "stripe";
  const payTransferEvent = (smsPayStage?.events ?? []).find(
    (e) => payActorMatches(e) && typeof e.text === "string" && /succeeded|settled|complete/i.test(e.text),
  );
  const downPayment =
    smsPayStage?.status === "complete" && payTransferEvent
      ? "$10 goodwill — settled"
      : smsPayStage?.status === "in_progress"
        ? "Authorization pending"
        : null;

  // Meeting confirmed — Cal.com event created.
  const meetingCreatedEvent = (meetingStage?.events ?? []).find(
    (e) => e.actor === "cal" && typeof e.text === "string",
  );
  const meetingConfirmed =
    meetingStage?.status === "complete" && meetingCreatedEvent
      ? (meetingCreatedEvent.text ?? "Booked")
      : meetingStage?.status === "in_progress"
        ? "Scheduling"
        : null;

  // Status — overall chain disposition.
  let status: string;
  const allStages = [chain.stages.form, chain.stages.call, chain.stages.email, chain.stages.sms_pay, chain.stages.meeting];
  const completeCount = allStages.filter((s) => s?.status === "complete").length;
  if (completeCount === 5) {
    status = "Contract locked";
  } else if (allStages.some((s) => s?.status === "failed")) {
    status = "Stalled — fallback in progress";
  } else if (completeCount === 0) {
    status = "Sequence not started";
  } else {
    status = `In flight (${completeCount}/5 stages complete)`;
  }

  const stamp = (
    field_id: string,
    label: string,
    value: string | null,
    sourceEvent?: ChainStageEvent,
  ): IntakeField => ({
    field_id,
    section: 8,
    label,
    class: "agent_filled",
    value,
    status: "agent_filled",
    ...(sourceEvent
      ? {
          provenance: {
            supplier_id: chain.supplier_id,
            channel: sourceEvent.channel ?? "email",
            evidence_id: sourceEvent.event_id,
            quote: sourceEvent.text,
          },
        }
      : {}),
  });

  return [
    stamp(SECTION_8_FIELD_IDS.contractAcceptance, "Contract acceptance", contractAcceptance, acceptanceEvent),
    stamp(SECTION_8_FIELD_IDS.downPayment, "Down payment", downPayment, payTransferEvent),
    stamp(SECTION_8_FIELD_IDS.meetingConfirmed, "Meeting confirmed", meetingConfirmed, meetingCreatedEvent),
    stamp(SECTION_8_FIELD_IDS.status, "Status", status),
  ];
}
