"use client";
// components/Output/ClimaxView.tsx
//
// Beat 5 climax — Filled Intake + Quote side-by-side. A right-pane header
// toggle swaps the climax docs view with the chain Lineage timeline. The
// workspace page owns the toggle state and passes it down so a provenance
// pill click on the FilledIntake can auto-toggle to lineage mode.

import { FilledIntake } from "./FilledIntake";
import { Quote } from "./Quote";
import type { IntakeForm } from "@/types/intake";
import type { SupplierEvidence } from "@/types/evidence";
import type { ChainState } from "@/types/chain";

export type ClimaxMode = "documents" | "lineage";

export interface ClimaxViewProps {
  intake: IntakeForm;
  evidence: SupplierEvidence[];
  chain: ChainState;
  selectedSupplierIds: string[];
  onProvenanceClick?: (eventId: string) => void;
}

export function ClimaxView({
  intake,
  evidence,
  chain,
  selectedSupplierIds,
  onProvenanceClick,
}: ClimaxViewProps) {
  return (
    <div className="climax-split">
      <div className="climax-pane climax-pane-intake">
        <FilledIntake
          intake={intake}
          evidence={evidence}
          chain={chain}
          selectedSupplierIds={selectedSupplierIds}
          onProvenanceClick={onProvenanceClick}
        />
      </div>
      <div className="climax-pane climax-pane-quote">
        <Quote spongeTransferId={chain.stages.sms_pay?.artifact_id} />
      </div>
    </div>
  );
}

export default ClimaxView;
