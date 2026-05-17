// chain-frames.ts — per-runId JPEG screenshot bus for chain timeline stages.
//
// Stage 1 (form fill) and Stage 5 (meeting booking) both run headless
// Chromium under the hood and stream JPEG frames into the chain timeline's
// stage cards. This module owns the in-memory bus + latest-frame cache so
// the chain SSE endpoint (app/api/chain/[runId]/stream/route.ts) can forward
// frames without each integration re-inventing the channel.
//
// Latest-frame-wins semantics — we never buffer history. A late SSE
// subscriber gets the most recent frame on subscribe and then live ticks.

import { EventEmitter } from "events";
import type { ChainStage } from "@/types/chain";

/** Stages that ship a live JPEG view in their timeline card. */
export type FrameStage = Extract<ChainStage, "form" | "meeting">;

export interface StageFrame {
  run_id: string;
  stage: FrameStage;
  /** ISO timestamp of capture. */
  ts: string;
  /** Base64-encoded JPEG (no data: prefix). */
  b64: string;
}

const BUS = new EventEmitter();
BUS.setMaxListeners(0);

/** Latest frame per (runId, stage) — emit-and-forget, latest-frame-wins. */
const LAST_FRAME = new Map<string, StageFrame>();

function key(runId: string, stage: FrameStage): string {
  return `${runId}:${stage}`;
}

function channel(runId: string): string {
  return `chain-frame:${runId}`;
}

/** Called from integration code (calcom.ts, future Stage 1 form-fill). */
export function emitStageFrame(frame: StageFrame): void {
  LAST_FRAME.set(key(frame.run_id, frame.stage), frame);
  BUS.emit(channel(frame.run_id), frame);
}

/**
 * Subscribe to all stage frames for a runId. On subscribe we replay the
 * latest cached frame for each known stage so late clients see an image
 * immediately instead of waiting for the next tick.
 */
export function subscribeToChainFrames(
  runId: string,
  onFrame: (frame: StageFrame) => void,
): () => void {
  const ch = channel(runId);
  BUS.on(ch, onFrame);
  for (const stage of ["form", "meeting"] as const) {
    const last = LAST_FRAME.get(key(runId, stage));
    if (last) onFrame(last);
  }
  return () => {
    BUS.off(ch, onFrame);
  };
}
