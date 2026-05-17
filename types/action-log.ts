// Supermemory-backed reasoning log — spec § 3.1.
//
// One record per agent action across every channel. The cross-channel
// leverage move (beat 5) is driven by Supermemory queries against these
// records.

import type { Channel } from "./biobank";

export interface ActionInput {
  // Slot values handed to the Builder. Free-form because each action's
  // schema is declared in its YAML; the runtime treats this as opaque.
  [slot: string]: unknown;
}

export interface ActionOutput {
  // Fields the Extractor pulled out of the counterparty response. Each
  // field carries an evidence_quote so we can show provenance in the UI.
  [field: string]:
    | {
        value: unknown;
        evidence_quote?: string;
      }
    | unknown;
}

export interface ActionReasoningLog {
  id: string;
  run_id: string;
  supplier_id: string;
  channel: Channel;
  action_id: string; // matches an entry in the channel YAML
  timestamp: string; // ISO

  // LLM-emitted: WHY the Planner picked this action this turn.
  reasoning: string;

  inputs: ActionInput;
  output: ActionOutput;

  // ids of prior ActionReasoningLog records this turn referenced
  // (Supermemory cross-channel query result).
  cross_channel_refs: string[];

  // Optional fields surfaced by some channels.
  prerequisites_satisfied?: string[];
  success?: boolean;
  error?: string;
}
