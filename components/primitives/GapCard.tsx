"use client";
import type { Gap } from "@/lib/tools/query_specimens";

export function GapCard({ gaps, onIntent }: { gaps: Gap[]; onIntent?: (intent: string) => void }) {
  if (!gaps.length) return null;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {gaps.map((g, i) => (
        <div key={i} className="gap">
          <div className="why">{g.why}</div>
          <div className="actions">
            {g.actions.map((a, j) => (
              <button key={j} className="btn-o" onClick={() => onIntent?.(a.intent)}>{a.label}</button>
            ))}
            <button className="btn-o" onClick={() => onIntent?.(`dismiss:${g.kind}`)} style={{ color: "var(--text-3)" }}>Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}
