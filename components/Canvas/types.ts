export type SlotState = "skeleton" | "ready" | "dim" | "pinned";

export type CanvasSlot = {
  key: string;                  // tool:filter_signature
  toolName: string;             // e.g. "query_specimens"
  state: SlotState;
  pinned: boolean;
  data: any;                    // tool result (tool-specific)
  callId: string;               // assistant message tool-call id
  turnId: number;               // monotonic per assistant turn
};
