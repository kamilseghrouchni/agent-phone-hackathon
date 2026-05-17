"use client";
import type { ProspectiveCard } from "@/lib/prospective";

export function ProspectiveList({
  cards,
  selectedId,
  onSelect,
}: {
  cards: ProspectiveCard[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (!cards.length) {
    return (
      <div className="rail-empty">
        No prospective partners with prior trial activity for this query.
      </div>
    );
  }
  return (
    <div className="ranked">
      {cards.map((c) => (
        <div
          key={c.id}
          className={`row-r ${selectedId === c.id ? "sel" : ""}`}
          onClick={() => onSelect(c.id)}
        >
          <div className="row-r-top">
            <div className="row-r-name">{c.institution}</div>
            <div className="row-r-country mono-sm">{stateCode(c.location)}</div>
          </div>
          {c.matched && (
            <div className="row-r-area mono-sm">{c.matched.area}</div>
          )}
          <div className="row-r-fact">{c.matched?.fact ?? fallback(c)}</div>
        </div>
      ))}
    </div>
  );
}

function stateCode(location: string): string {
  // "New Orleans, LA" → "LA"
  const parts = location.split(",").map((s) => s.trim());
  return parts[parts.length - 1] || location;
}

function fallback(c: ProspectiveCard): string {
  const probe = c.probeState.split("·")[0].trim();
  const pool = stripMd(c.layer1.poolSize).split(/[·.;]/)[0].trim();
  if (probe && pool) return `${probe} · ${pool}`;
  return probe || pool;
}

function stripMd(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}
