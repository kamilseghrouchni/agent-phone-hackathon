"use client";
// components/Output/ClimaxView.tsx
//
// Beat 5 climax — Quote-only, full-width. The Filled Intake §1–8 doc was
// removed for the demo (audience reads the chain Timeline for provenance;
// the climax just needs the deliverable on screen). A right-pane header
// toggle in app/workspace/page.tsx still swaps this docs view with the
// chain Lineage timeline.

import { Quote } from "./Quote";
import type { ChainState } from "@/types/chain";

export type ClimaxMode = "documents" | "lineage";

export interface ClimaxViewProps {
  chain: ChainState;
}

export function ClimaxView({ chain }: ClimaxViewProps) {
  return (
    <div className="climax-split">
      <div className="climax-pane climax-pane-quote">
        <Quote spongeTransferId={chain.stages.sms_pay?.artifact_id} />
      </div>
    </div>
  );
}

export default ClimaxView;
