"use client";
import { useMemo, useState } from "react";
import type { UIMessage } from "ai";
import { InstituteList } from "@/components/primitives/InstituteList";
import { PublicationPanel } from "@/components/primitives/PublicationPanel";
import { GapCard } from "@/components/primitives/GapCard";
import { RequestForm } from "@/components/primitives/RequestForm";
import type { CanvasSlot, SlotState } from "./types";

/** Turn assistant messages into canvas slots, applying mutation rules:
 *  - same key (tool + filter signature) → replace (latest wins)
 *  - new key → insert (in arrival order)
 *  - older turn slots → "dim" unless pinned
 *  - skeleton when tool call has started but no result yet
 */
function buildSlots(messages: UIMessage[], pinned: Set<string>): CanvasSlot[] {
  const byKey = new Map<string, CanvasSlot>();
  let turnId = 0;
  let latestTurnId = 0;

  for (const m of messages) {
    if (m.role !== "assistant") continue;
    turnId += 1;
    let turnHadResult = false;
    for (const p of (m.parts ?? []) as any[]) {
      if (!p.type?.startsWith("tool-")) continue;
      const toolName = p.type.replace("tool-", "");
      const callId = p.toolCallId ?? "?";
      const input = p.input ?? {};
      const output = p.output ?? null;
      const state: any = p.state;

      // Compute slot key from tool result if available (filters_applied is canonicalized server-side),
      // else from tool input as a best-effort skeleton key.
      const filterSrc = output?.filters_applied ?? input ?? {};
      const key = computeSlotKey(toolName, filterSrc);

      const slotState: SlotState =
        state === "input-streaming" || state === "input-available"
          ? "skeleton"
          : output
          ? "ready"
          : "skeleton";

      const slot: CanvasSlot = {
        key,
        toolName,
        state: slotState,
        pinned: pinned.has(key),
        data: output ?? input,
        callId,
        turnId,
      };
      byKey.set(key, slot);
      if (output) turnHadResult = true;
    }
    if (turnHadResult) latestTurnId = turnId;
  }

  // Ordering: stable in insertion order
  const out: CanvasSlot[] = Array.from(byKey.values());

  // Apply dimming: any slot whose turnId < latest active turn AND not pinned → dim
  for (const s of out) {
    if (s.state !== "ready") continue;
    if (s.pinned) { s.state = "pinned"; continue; }
    if (s.turnId < latestTurnId) s.state = "dim";
  }
  return out;
}

/** Stable, deterministic key. Mirrors lib/filters.signature for the simple cases the LLM emits. */
function computeSlotKey(tool: string, filters: any): string {
  // Strip display_grouping (UI hint, not a filter)
  const cleaned: any = {};
  const keys = Object.keys(filters ?? {})
    .filter((k) => k !== "display_grouping" && filters[k] !== undefined && filters[k] !== null)
    .sort();
  for (const k of keys) {
    const v = filters[k];
    cleaned[k] = Array.isArray(v) ? [...v].map((x) => String(x).toLowerCase()).sort() : typeof v === "string" ? v.toLowerCase() : v;
  }
  // Cheap client-side hash — not crypto, just stable
  const json = JSON.stringify(cleaned);
  let h = 0;
  for (let i = 0; i < json.length; i++) h = ((h << 5) - h + json.charCodeAt(i)) | 0;
  return `${tool}:${(h >>> 0).toString(36).slice(0, 10)}`;
}

export function Canvas({ messages, onUserIntent }: { messages: UIMessage[]; onUserIntent?: (text: string) => void }) {
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const slots = useMemo(() => buildSlots(messages, pinned), [messages, pinned]);

  const togglePin = (key: string) => {
    setPinned((p) => {
      const n = new Set(p);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  };

  if (slots.length === 0) {
    return (
      <div className="empty-canvas">
        Ask anything about the biobank network. The agent will mount results here as it works.
      </div>
    );
  }

  return (
    <>
      {slots.map((s) => (
        <SlotShell key={s.key} slot={s} onTogglePin={() => togglePin(s.key)}>
          <SlotBody slot={s} onUserIntent={onUserIntent} />
        </SlotShell>
      ))}
    </>
  );
}

function SlotShell({ slot, onTogglePin, children }: { slot: CanvasSlot; onTogglePin: () => void; children: React.ReactNode }) {
  const cls = ["slot"];
  if (slot.state === "skeleton") cls.push("skeleton");
  if (slot.state === "dim") cls.push("dim");
  if (slot.state === "pinned") cls.push("pinned");
  return (
    <section className={cls.join(" ")} data-slot-key={slot.key}>
      <div className="slot-hd">
        <span className="name">{slot.toolName.replace(/_/g, " ")}</span>
        <span className="filt">{filterSummary(slot.data)}</span>
        {slot.state === "ready" || slot.state === "pinned" ? (
          <button className="pinbtn" onClick={onTogglePin}>{slot.pinned ? "unpin" : "pin"}</button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function filterSummary(data: any): string {
  const f = data?.filters_applied ?? data ?? {};
  const parts: string[] = [];
  if (f.indication?.length) parts.push(f.indication.join("·"));
  if (f.specimen_types?.length) parts.push(f.specimen_types.join("+"));
  if (f.preservation) parts.push(f.preservation);
  if (f.longitudinal) parts.push("longitudinal");
  if (f.has_contact_email) parts.push("with-contact");
  if (f.display_grouping) parts.push(`grouped-by-${f.display_grouping}`);
  return parts.slice(0, 4).join(" · ");
}

function SlotBody({ slot, onUserIntent }: { slot: CanvasSlot; onUserIntent?: (s: string) => void }) {
  if (slot.state === "skeleton") {
    return (
      <div className="skeleton-rows">
        <div className="skeleton-row" />
        <div className="skeleton-row" />
        <div className="skeleton-row" />
      </div>
    );
  }
  switch (slot.toolName) {
    case "query_specimens":
      return (
        <>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 12 }}>
            <span className="tag brand">{slot.data.totals.specimens.toLocaleString()} specimens</span>{" "}
            <span className="tag">{slot.data.totals.donors.toLocaleString()} donors</span>{" "}
            <span className="tag">{slot.data.totals.institutes} institutes</span>
            {slot.data.totals.longitudinal_donors > 0 && (
              <> <span className="tag">{slot.data.totals.longitudinal_donors.toLocaleString()} longitudinal</span></>
            )}
          </div>
          <InstituteList data={slot.data} />
          {slot.data.gaps?.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <GapCard gaps={slot.data.gaps} onIntent={onUserIntent} />
            </div>
          )}
        </>
      );
    case "find_publications":
      return (
        <>
          <PublicationPanel data={slot.data} />
          {slot.data.gaps?.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <GapCard gaps={slot.data.gaps} onIntent={onUserIntent} />
            </div>
          )}
        </>
      );
    case "compare_institutes":
      return <CompareView data={slot.data} />;
    case "open_request_form":
      return <RequestForm data={slot.data} />;
    default:
      return <pre style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>{JSON.stringify(slot.data, null, 2)}</pre>;
  }
}

function CompareView({ data }: { data: any }) {
  if (!data.rows?.length) return <div className="empty-canvas">Nothing to compare.</div>;
  const types = Array.from(new Set(data.rows.flatMap((r: any) => Object.keys(r.by_specimen_type)))) as string[];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--text-3)", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase" }}>
            <th style={{ padding: "8px 10px" }}>Institute</th>
            <th>Specimens</th>
            <th>Donors</th>
            <th>Longitudinal</th>
            <th>Contact</th>
            {types.map((t) => <th key={t}>{t.split(" ")[0]}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r: any) => (
            <tr key={r.organization_id} style={{ borderTop: "1px dashed var(--bg-sunk)" }}>
              <td style={{ padding: "10px 10px" }}>{r.flag} {r.name}</td>
              <td>{r.specimen_count.toLocaleString()}</td>
              <td>{r.donor_count.toLocaleString()}</td>
              <td>{r.longitudinal_donor_count.toLocaleString()}</td>
              <td>{r.contact_email ? "✓" : <span style={{ color: "var(--text-3)" }}>—</span>}</td>
              {types.map((t) => <td key={t}>{(r.by_specimen_type[t] ?? 0).toLocaleString()}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
