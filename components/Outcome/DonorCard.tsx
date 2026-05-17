"use client";
import type { SpecimenRow } from "@/lib/tools/query_specimens";

function shortDx(s: string | null): string {
  if (!s) return "";
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.filter(Boolean).join("; ");
  } catch {}
  return s.replace(/\s+/g, " ");
}

function leadingDx(raw: string): string {
  // Drop generic prefix like "Neurological condition;" — keep the specific line.
  const parts = raw.split(/[;|]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return raw.trim();
  // Prefer the last part if the first looks like a category header
  const first = parts[0].toLowerCase();
  if (first.endsWith("condition") || first.endsWith("disease") || first.endsWith("disorder") || first.endsWith("category")) {
    return parts[parts.length - 1];
  }
  return parts.join(" · ");
}

export type DonorGroup = {
  donorKey: string;
  donorIdLabel: string | null;
  rows: SpecimenRow[];
};

export function groupRowsByDonor(rows: SpecimenRow[]): DonorGroup[] {
  const m = new Map<string, SpecimenRow[]>();
  for (const r of rows) {
    const key = r.external_donor_id ?? r.donor_id ?? r.specimen_id;
    const arr = m.get(key);
    if (arr) arr.push(r);
    else m.set(key, [r]);
  }
  return Array.from(m.entries()).map(([k, rs]) => ({
    donorKey: k,
    donorIdLabel: rs[0].external_donor_id ?? (rs[0].donor_id ? rs[0].donor_id.slice(0, 12) + "…" : null),
    rows: rs,
  }));
}

export function DonorCard({ group, onOpen }: { group: DonorGroup; onOpen?: (row: SpecimenRow) => void }) {
  const rows = group.rows;
  const head = rows[0];
  const rawDx = shortDx(head.donor_diagnoses) || shortDx(head.specimen_diagnoses) || shortDx(head.unstructured_pathology);
  const dx = rawDx ? leadingDx(rawDx) : "";

  const typeCounts = new Map<string, number>();
  for (const r of rows) {
    const t = r.specimen_type ?? "—";
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const typesLine = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => (n > 1 ? `${t} ×${n}` : t))
    .join(" · ");

  const ages = rows.map((r) => r.age).filter((a): a is number => a != null);
  const ageLbl = ages.length === 0
    ? null
    : Math.min(...ages) === Math.max(...ages)
      ? `${ages[0]}y`
      : `${Math.min(...ages)}–${Math.max(...ages)}y`;

  const sex = head.sex ? (head.sex.toLowerCase().startsWith("f") ? "Female" : head.sex.toLowerCase().startsWith("m") ? "Male" : head.sex) : null;
  const visitsLbl = rows.length > 1 ? `${rows.length} visits` : "1 visit";

  return (
    <div className="dcard" onClick={() => onOpen?.(head)} role="button" tabIndex={0}>
      <div className="dcard-top">
        <div className="dcard-type">{typesLine}</div>
        <div className="dcard-visits mono">{visitsLbl}</div>
      </div>
      {(sex || ageLbl) && (
        <div className="dcard-demo">
          {[sex, ageLbl].filter(Boolean).join(" · ")}
        </div>
      )}
      {dx && <div className="dcard-dx">{dx}</div>}
      <div className="dcard-foot mono">View detail →</div>
    </div>
  );
}
