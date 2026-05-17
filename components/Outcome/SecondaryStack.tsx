"use client";
import type { UIMessage } from "ai";
import { PublicationPanel } from "@/components/primitives/PublicationPanel";
import { GapCard } from "@/components/primitives/GapCard";
import { RequestForm } from "@/components/primitives/RequestForm";

/** Renders non-institute primitives stacked: publications, gaps, request forms.
 *  Used when no institute is selected (initial state or after the agent commissioned a form). */
export function SecondaryStack({
  messages,
  onUserIntent,
}: {
  messages: UIMessage[];
  onUserIntent: (intent: string) => void;
}) {
  const items: { type: string; data: any; key: string }[] = [];
  const seenKeys = new Set<string>();
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const p of (m.parts ?? []) as any[]) {
      if (!p.type?.startsWith("tool-") || !p.output) continue;
      const tool = p.type.replace("tool-", "");
      if (tool === "find_publications") {
        const k = `pubs:${(p.output.papers ?? []).length}:${p.output.papers?.[0]?.pmid ?? "x"}`;
        if (!seenKeys.has(k)) { items.push({ type: "pubs", data: p.output, key: k }); seenKeys.add(k); }
      } else if (tool === "open_request_form") {
        const k = `form:${p.output.scope}:${p.toolCallId}`;
        if (!seenKeys.has(k)) { items.push({ type: "form", data: p.output, key: k }); seenKeys.add(k); }
      }
    }
  }
  // Latest query gaps (across the chain) — show once at top
  let queryGaps: any[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const p of (m.parts ?? []) as any[]) {
      if (p.type === "tool-query_specimens" && p.output?.gaps?.length) queryGaps = p.output.gaps;
    }
  }
  if (!items.length && !queryGaps.length) {
    return <div className="detail-empty">Ask a question below — the catalog and curated literature will appear here.</div>;
  }
  return (
    <>
      {queryGaps.length > 0 && (
        <section className="det-section" style={{ borderBottom: 0, paddingTop: 0 }}>
          <div className="sect-lbl">Gaps in catalog</div>
          <GapCard gaps={queryGaps} onIntent={onUserIntent} />
        </section>
      )}
      {items.map((it) => (
        <section key={it.key} className="det-section">
          <div className="sect-lbl">{it.type === "pubs" ? "Curated literature" : "Request form"}</div>
          {it.type === "pubs" ? <PublicationPanel data={it.data} /> : <RequestForm data={it.data} />}
        </section>
      ))}
    </>
  );
}
