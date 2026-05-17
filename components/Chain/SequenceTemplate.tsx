"use client";
import {
  CHAIN_STAGE_ORDER,
  CHAIN_STAGE_LABELS,
  type ChainStage,
  type ChainState,
} from "@/types/chain";

/**
 * SequenceTemplate — Beat 4 horizontal 5-stage strip.
 *
 * Renders each stage as a tile with status styling:
 *   locked | ready | in_progress | complete | failed | fallback
 */
export function SequenceTemplate({
  chain,
  onStageClick,
}: {
  chain: ChainState;
  onStageClick?: (stage: ChainStage) => void;
}) {
  return (
    <div className="seq-tpl">
      {CHAIN_STAGE_ORDER.map((stage, i) => {
        const s = chain.stages[stage];
        const label = CHAIN_STAGE_LABELS[stage];
        const status = s?.status ?? "locked";
        return (
          <div key={stage} className="seq-cell">
            <button
              className={`seq-tile status-${status}`}
              onClick={() => onStageClick?.(stage)}
              type="button"
            >
              <span className="seq-num mono-sm">0{i + 1}</span>
              <span className="seq-name mono">{label.short}</span>
              <span className="seq-sub">{label.sub}</span>
              <span className={`seq-status mono-sm status-${status}`}>{statusLabel(status)}</span>
            </button>
            {i < CHAIN_STAGE_ORDER.length - 1 && (
              <span className={`seq-arrow ${status === "complete" ? "done" : ""}`} aria-hidden>→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function statusLabel(s: string): string {
  switch (s) {
    case "locked":
      return "locked";
    case "ready":
      return "ready";
    case "in_progress":
      return "running";
    case "complete":
      return "✓ complete";
    case "failed":
      return "✗ failed";
    case "fallback":
      return "↻ fallback";
    default:
      return s;
  }
}
