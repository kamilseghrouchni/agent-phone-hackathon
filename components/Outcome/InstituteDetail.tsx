"use client";
import { useMemo, useState } from "react";
import type { InstituteEntry, QuerySpecimensResult, SpecimenRow } from "@/lib/tools/query_specimens";
import type { SpecimenFilters } from "@/lib/filters";
import type { Publication } from "@/lib/publications";
import type { FindPublicationsResult } from "@/lib/tools/find_publications";
import { DonorCard, groupRowsByDonor } from "./DonorCard";

export function InstituteDetail({
  inst,
  query,
  pubs,
  onHandoff,
  onOpenSpecimen,
}: {
  inst: InstituteEntry;
  query: QuerySpecimensResult;
  pubs: FindPublicationsResult | null;
  onHandoff: () => void;
  onOpenSpecimen?: (row: SpecimenRow) => void;
}) {
  const matchingPubs = ((pubs?.papers ?? []) as Publication[]).filter((p) => paperTouchesInstitute(p, inst.name)).slice(0, 3);

  return (
    <>
      <div className="det-title-row">
        <div style={{ flex: 1 }}>
          <div className="lbl">Institution</div>
          <div className="det-title">{inst.name}</div>
          {inst.country && <div className="det-sub">{inst.country}</div>}
        </div>
        <button className="btn-p brand" onClick={onHandoff}>
          Launch an audit →
        </button>
      </div>

      {inst.description && (
        <section className="det-section">
          <div className="sect-lbl">About</div>
          <div style={{ fontSize: 15, lineHeight: 1.6, color: "var(--text)" }}>{inst.description}</div>
        </section>
      )}

      <BundleSection inst={inst} filters={query.filters_applied} onOpen={onOpenSpecimen} />

      <section className="det-section">
        <div className="sect-lbl">Contact & access</div>
        <div className="kv-grid">
          <div className="kv-card">
            <div className="k">Contact</div>
            <div className="v">
              {inst.contact_email ? (
                <a href={`mailto:${inst.contact_email}`} style={{ color: "var(--brand-ink)", textDecoration: "none" }}>{inst.contact_email}</a>
              ) : (
                <span className="tag warn">No public contact</span>
              )}
            </div>
          </div>
          <div className="kv-card">
            <div className="k muted">Web</div>
            <div className="v">
              {inst.website ? <a href={inst.website} target="_blank" rel="noreferrer" style={{ color: "var(--brand-ink)", textDecoration: "none" }}>{inst.website}</a> : <span style={{ color: "var(--text-3)" }}>—</span>}
            </div>
          </div>
        </div>
      </section>

      {matchingPubs.length > 0 && (
        <section className="det-section">
          <div className="sect-lbl">Literature</div>
          <div className="pubs">
            {matchingPubs.map((p: Publication) => (
              <div key={(p.pmid ?? p.title) || ""} className="pub">
                <div className="title">{p.title}</div>
                <div className="meta">{p.journal ?? "—"} · {p.year ?? "—"}</div>
                <div className="pmid">{p.pmid ? `PMID:${p.pmid}` : ""} {p.pmc_id ? `· ${p.pmc_id}` : ""}</div>
                {p.notes && <div className="notes">{p.notes}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

    </>
  );
}

function BundleSection({
  inst,
  filters,
  onOpen,
}: {
  inst: InstituteEntry;
  filters: SpecimenFilters;
  onOpen?: (row: SpecimenRow) => void;
}) {
  const [donorsOpen, setDonorsOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const rows = inst.sample_rows;
  const groups = useMemo(() => groupRowsByDonor(rows), [rows]);
  const visible = showAll ? groups : groups.slice(0, 8);
  const reasons = useMemo(() => buildMatchReasons(inst, filters), [inst, filters]);
  const topTypes = useMemo(
    () =>
      Object.entries(inst.by_specimen_type)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4),
    [inst.by_specimen_type],
  );

  if (rows.length === 0) {
    return (
      <section className="det-section">
        <div className="sect-lbl">Bundle</div>
        <div style={{ color: "var(--text-3)", fontSize: 13 }}>No matching specimens surfaced for this institute under the current filters.</div>
      </section>
    );
  }

  return (
    <section className="det-section">
      <div className="sect-lbl">
        Bundle · {groups.length} donor{groups.length === 1 ? "" : "s"}
        <span style={{ color: "var(--text-3)", marginLeft: 8 }}>
          {rows.length} specimens{inst.specimen_count > rows.length ? ` of ${inst.specimen_count.toLocaleString()} cataloged` : ""}
        </span>
      </div>

      <div className="bundle-card" role="button" tabIndex={0} onClick={() => setDonorsOpen((s) => !s)}>
        <div className="bundle-head">
          <div className="bundle-title">Why this institute matches</div>
          <span className="bundle-toggle">
            {donorsOpen ? "Hide donors ▴" : `Show ${groups.length} donor${groups.length === 1 ? "" : "s"} ▾`}
          </span>
        </div>

        {reasons.length > 0 && (
          <ul className="bundle-reasons">
            {reasons.map((r) => (
              <li key={r.label} className={`bundle-reason ${r.tone}`}>
                <span className="mark">{r.tone === "hit" ? "✓" : r.tone === "partial" ? "≈" : "—"}</span>
                <span className="text">{r.label}</span>
              </li>
            ))}
          </ul>
        )}

        {topTypes.length > 0 && (
          <div className="bundle-types">
            {topTypes.map(([t, n]) => (
              <span key={t} className="pill">{t} · {n.toLocaleString()}</span>
            ))}
          </div>
        )}
      </div>

      {donorsOpen && (
        <>
          <div className="specimen-mix" style={{ marginTop: 10 }}>
            {visible.map((g) => <DonorCard key={g.donorKey} group={g} onOpen={onOpen} />)}
          </div>
          {groups.length > 8 && (
            <button className="show-more" style={{ marginTop: 10 }} onClick={() => setShowAll((s) => !s)}>
              {showAll ? `Collapse to first 8` : `Show all ${groups.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

type Reason = { label: string; tone: "hit" | "partial" | "miss" };

function buildMatchReasons(inst: InstituteEntry, f: SpecimenFilters): Reason[] {
  const rows = inst.sample_rows;
  const total = rows.length;
  const out: Reason[] = [];

  const flagCount = (key: keyof NonNullable<SpecimenRow["match_flags"]>): number =>
    rows.reduce((acc, r) => acc + (r.match_flags?.[key] ? 1 : 0), 0);

  if (f.indication?.length) {
    const n = flagCount("indication");
    out.push({
      label: `${labelCount(n, total)} match ${joinList(f.indication)}`,
      tone: tone(n, total),
    });
  }
  if (f.specimen_types?.length) {
    const n = flagCount("specimen_type");
    out.push({
      label: `${labelCount(n, total)} are ${joinList(f.specimen_types)}`,
      tone: tone(n, total),
    });
  }
  if (f.preservation) {
    const presList = Array.isArray(f.preservation) ? f.preservation : [f.preservation];
    const n = flagCount("preservation");
    out.push({
      label: `${labelCount(n, total)} preserved as ${joinList(presList)}`,
      tone: tone(n, total),
    });
  }
  if (f.anatomy?.length) {
    const n = flagCount("anatomy");
    out.push({
      label: `${labelCount(n, total)} from ${joinList(f.anatomy)}`,
      tone: tone(n, total),
    });
  }
  if (f.age_range && (f.age_range[0] != null || f.age_range[1] != null)) {
    const n = flagCount("age");
    const lo = f.age_range[0];
    const hi = f.age_range[1];
    const range = lo != null && hi != null ? `${lo}–${hi}` : lo != null ? `≥${lo}` : `≤${hi}`;
    out.push({
      label: `${labelCount(n, total)} in age range ${range}`,
      tone: tone(n, total),
    });
  }
  if (f.longitudinal) {
    const n = inst.longitudinal_donor_count;
    out.push({
      label: n > 0 ? `${n.toLocaleString()} longitudinal donor${n === 1 ? "" : "s"} (≥2 collection years)` : "No longitudinal donors",
      tone: n > 0 ? "hit" : "miss",
    });
  }
  if (f.matched_pairs_required) {
    const n = inst.matched_pair_donor_count;
    out.push({
      label: n > 0 ? `${n.toLocaleString()} donor${n === 1 ? "" : "s"} with matched pairs` : "No matched-pair donors",
      tone: n > 0 ? "hit" : "miss",
    });
  }
  if (f.min_n != null) {
    const ok = inst.specimen_count >= f.min_n;
    out.push({
      label: `${inst.specimen_count.toLocaleString()} cataloged vs requested ≥${f.min_n.toLocaleString()}`,
      tone: ok ? "hit" : "miss",
    });
  }
  if (f.has_contact_email || f.has_contact_email === undefined) {
    out.push({
      label: inst.contact_email ? "Direct contact email available" : "No public contact — outreach blocked",
      tone: inst.contact_email ? "hit" : "miss",
    });
  }
  if (f.countries?.length) {
    const want = f.countries.map((c) => c.toLowerCase());
    const ok = inst.country ? want.includes(inst.country.toLowerCase()) : false;
    out.push({
      label: ok ? `Located in ${inst.country}` : `Outside requested ${joinList(f.countries)}`,
      tone: ok ? "hit" : "miss",
    });
  }
  return out;
}

function tone(n: number, total: number): "hit" | "partial" | "miss" {
  if (total === 0) return "miss";
  if (n === total) return "hit";
  if (n === 0) return "miss";
  return "partial";
}

function labelCount(n: number, total: number): string {
  if (total === 0) return "0";
  if (n === total) return `All ${total}`;
  return `${n} of ${total}`;
}

function joinList(xs: string[]): string {
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} or ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;
}

function paperTouchesInstitute(p: Publication, name: string): boolean {
  const inst = (p.institution ?? "").toLowerCase();
  const n = name.toLowerCase();
  if (!inst || !n) return false;
  const words = n.split(/\s+/).filter((w) => w.length >= 4);
  return words.some((w) => inst.includes(w));
}
