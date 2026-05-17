"use client";
import type { InstituteEntry } from "@/lib/tools/query_specimens";

type Segment = { type: string; n: number; share: number };

function compositionFor(inst: InstituteEntry): Segment[] {
  const entries = Object.entries(inst.by_specimen_type ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return [];
  return entries.map(([type, n]) => ({
    type,
    n,
    share: n / total,
  }));
}

function compositionLabel(segs: Segment[]): string {
  if (segs.length === 0) return "";
  const top = segs[0];
  if (top.share >= 0.85) return `almost all ${top.type.toLowerCase()}`;
  if (top.share >= 0.6) {
    const second = segs[1];
    return second
      ? `mostly ${top.type.toLowerCase()} · some ${second.type.toLowerCase()}`
      : `mostly ${top.type.toLowerCase()}`;
  }
  const second = segs[1];
  if (second && second.share >= 0.25) {
    return `${top.type.toLowerCase()} and ${second.type.toLowerCase()}`;
  }
  return `${top.type.toLowerCase()}, mixed`;
}

export function RankedList({
  institutes,
  selectedId,
  onSelect,
}: {
  institutes: InstituteEntry[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (!institutes.length) {
    return <div className="rail-empty">Nothing matched in the bank.</div>;
  }

  return (
    <div className="ranked">
      {institutes.map((i) => {
        const sampleN = i.sample_rows.length;
        const comp = compositionFor(i);
        const compLabel = compositionLabel(comp);
        // Two cases:
        //  - DB-backed (sampleN > 0): "N of M specimens" where N is what we surfaced
        //  - Catalog-only (sampleN = 0, common in demo mode + warm CROs): "M specimens"
        //    where M is the reported inventory ceiling. No "0 of …" misreading.
        const fact =
          sampleN > 0 && i.specimen_count > sampleN
            ? `${sampleN} of ${i.specimen_count.toLocaleString()} specimens`
            : i.specimen_count === 0
              ? "meta — discovery layer"
              : `${i.specimen_count.toLocaleString()} specimens`;
        return (
          <div
            key={i.organization_id}
            className={`row-r ${selectedId === i.organization_id ? "sel" : ""}`}
            onClick={() => onSelect(i.organization_id)}
          >
            <div className="row-r-top">
              <div className="row-r-name">{i.name}</div>
              <div className="row-r-country mono-sm">{i.country ?? "—"}</div>
            </div>
            <div className="row-r-fact">
              {fact}
              {compLabel && <span className="row-r-mix"> · {compLabel}</span>}
              {!i.contact_email && <span className="row-r-warn"> · no contact</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
