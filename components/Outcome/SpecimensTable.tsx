"use client";
import { Fragment, useMemo, useState } from "react";
import type { InstituteEntry, QuerySpecimensResult, SpecimenRow } from "@/lib/tools/query_specimens";
import type { SpecimenFilters } from "@/lib/filters";

type SortKey = "year" | "age" | "type" | "preservation" | "country";
const COL_COUNT = 9;

export function SpecimensTable({ data, onOpen }: { data: QuerySpecimensResult; onOpen?: (row: SpecimenRow) => void }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("year");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [openOrgs, setOpenOrgs] = useState<Set<string>>(() => new Set());

  const orgById = useMemo(() => {
    const m: Record<string, InstituteEntry> = {};
    for (const i of data.institutes) m[i.organization_id] = i;
    return m;
  }, [data.institutes]);

  const sortRows = (rows: SpecimenRow[]): SpecimenRow[] => {
    const cmp = (a: SpecimenRow, b: SpecimenRow): number => {
      let av: any, bv: any;
      switch (sort) {
        case "year": av = a.year ?? -1; bv = b.year ?? -1; break;
        case "age": av = a.age ?? -1; bv = b.age ?? -1; break;
        case "type": av = a.specimen_type ?? ""; bv = b.specimen_type ?? ""; break;
        case "preservation": av = a.preservation_category ?? ""; bv = b.preservation_category ?? ""; break;
        case "country": av = a.country ?? ""; bv = b.country ?? ""; break;
      }
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    };
    return [...rows].sort(cmp);
  };

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = data.table_rows;
    if (q) {
      rows = rows.filter((r) => {
        const orgName = r.organization_id ? orgById[r.organization_id]?.name ?? "" : "";
        const blob = [
          r.specimen_type, r.raw_anatomy, r.source_site, r.country, r.preservation_category,
          r.donor_diagnoses, r.specimen_diagnoses, r.unstructured_pathology,
          r.tnm?.T, r.tnm?.N, r.tnm?.M, r.grade, r.stage, orgName,
        ].filter(Boolean).join(" ").toLowerCase();
        return blob.includes(q);
      });
    }

    const byOrg = new Map<string, SpecimenRow[]>();
    for (const r of rows) {
      const key = r.organization_id ?? "__none__";
      const arr = byOrg.get(key);
      if (arr) arr.push(r);
      else byOrg.set(key, [r]);
    }

    return data.institutes
      .map((inst) => ({ inst, rows: sortRows(byOrg.get(inst.organization_id) ?? []) }))
      .filter((g) => g.rows.length > 0);
  }, [data.table_rows, data.institutes, search, sort, dir, orgById]);

  const totalShown = useMemo(() => groups.reduce((acc, g) => acc + g.rows.length, 0), [groups]);

  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th
      style={{ cursor: "pointer", userSelect: "none" }}
      onClick={() => {
        if (sort === k) setDir(dir === "asc" ? "desc" : "asc");
        else { setSort(k); setDir("desc"); }
      }}
    >
      {children}{sort === k ? (dir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );

  const allOpen = openOrgs.size > 0 && openOrgs.size >= groups.length;
  const toggleOrg = (id: string) =>
    setOpenOrgs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setOpenOrgs(allOpen ? new Set() : new Set(groups.map((g) => g.inst.organization_id)));

  return (
    <>
      <div className="table-controls">
        <input
          className="table-search"
          type="search"
          placeholder="search within results — diagnosis, country, T/N/M, anatomy…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".1em", color: "var(--text-3)", textTransform: "uppercase" }}>
          {totalShown.toLocaleString()} of {data.table_rows.length.toLocaleString()} sampled across {groups.length} institute{groups.length === 1 ? "" : "s"} · {data.totals.specimens.toLocaleString()} total matched
        </span>
        <button className="show-more" style={{ width: "auto", padding: "6px 12px" }} onClick={toggleAll}>
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <div style={{ overflowX: "auto", border: "1px solid var(--bg-sunk)", borderRadius: 10, background: "#FBF9F4" }}>
        <table className="spec-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Institute</th>
              <Th k="type">Type</Th>
              <th>Anatomy / Dx</th>
              <Th k="preservation">Preservation</Th>
              <Th k="age">Age / Sex</Th>
              <Th k="country">Country</Th>
              <Th k="year">Year</Th>
              <th>T/N/M · Grade</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ inst, rows }) => {
              const open = openOrgs.has(inst.organization_id);
              const reasons = summarizeMatch(inst, data.filters_applied);
              return (
                <Fragment key={inst.organization_id}>
                  <tr className="org-row" onClick={() => toggleOrg(inst.organization_id)}>
                    <td colSpan={COL_COUNT}>
                      <div className="org-row-inner">
                        <span className="org-caret">{open ? "▾" : "▸"}</span>
                        <span className="org-name">{inst.name}</span>
                        <span className="org-meta">
                          {inst.country ?? "—"} · {rows.length} matching specimen{rows.length === 1 ? "" : "s"} · {inst.donor_count.toLocaleString()} donors
                          {inst.longitudinal_donor_count > 0 ? ` · ${inst.longitudinal_donor_count.toLocaleString()} long.` : ""}
                        </span>
                        {reasons.length > 0 && (
                          <span className="org-reasons">
                            {reasons.map((r) => (
                              <span key={r} className="org-reason">{r}</span>
                            ))}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                  {open && rows.map((r) => (
                    <tr
                      key={r.specimen_id + (r.donor_id ?? "")}
                      className="org-child"
                      onClick={() => onOpen?.(r)}
                      style={{ cursor: onOpen ? "pointer" : "default" }}
                    >
                      <td className="sid">{r.external_specimen_id ?? r.specimen_id.slice(0, 10) + "…"}</td>
                      <td className="inst" style={{ color: "var(--text-3)" }}>↳</td>
                      <td>{r.specimen_type ?? "—"}</td>
                      <td>
                        <div>{shortAnat(r.raw_anatomy, r.source_site) || "—"}</div>
                        {dxShort(r) && <div style={{ color: "var(--text-2)", fontSize: 11 }}>{dxShort(r)}</div>}
                      </td>
                      <td className="nowrap">
                        {r.preservation_category ?? "—"}
                        {r.storage_temp ? <span style={{ color: "var(--text-3)", marginLeft: 6 }}>{r.storage_temp}</span> : null}
                      </td>
                      <td className="nowrap">{r.age ?? "—"} · {r.sex?.[0] ?? "—"}</td>
                      <td>{r.country ?? "—"}</td>
                      <td>{r.year ?? "—"}</td>
                      <td className="nowrap">
                        {r.tnm ? `T${r.tnm.T ?? "?"}N${r.tnm.N ?? "?"}M${r.tnm.M ?? "?"}` : "—"}
                        {r.grade ? ` · G${r.grade}` : ""}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function summarizeMatch(inst: InstituteEntry, f: SpecimenFilters): string[] {
  const rows = inst.sample_rows;
  const total = rows.length;
  const out: string[] = [];
  const flagAll = (key: keyof NonNullable<SpecimenRow["match_flags"]>): boolean =>
    total > 0 && rows.every((r) => r.match_flags?.[key]);

  if (f.indication?.length && flagAll("indication")) out.push(`✓ ${f.indication.join("/")}`);
  if (f.specimen_types?.length && flagAll("specimen_type")) out.push(`✓ ${f.specimen_types.join("/")}`);
  if (f.preservation && flagAll("preservation")) {
    const pres = Array.isArray(f.preservation) ? f.preservation.join("/") : f.preservation;
    out.push(`✓ ${pres}`);
  }
  if (f.anatomy?.length && flagAll("anatomy")) out.push(`✓ ${f.anatomy.join("/")}`);
  if (f.longitudinal && inst.longitudinal_donor_count > 0) out.push(`✓ longitudinal`);
  if (f.matched_pairs_required && inst.matched_pair_donor_count > 0) out.push(`✓ matched pairs`);
  if (inst.contact_email) out.push(`✓ contact`);
  return out;
}

function shortAnat(raw: string | null, fallback: string | null): string {
  const s = raw ?? fallback ?? "";
  return s.replace(/^anatomic_site:\s*/i, "").trim();
}

function dxShort(r: SpecimenRow): string {
  const try1 = (s: string | null | undefined): string => {
    if (!s) return "";
    try {
      const p = JSON.parse(s);
      if (Array.isArray(p)) return p.filter(Boolean).join("; ");
    } catch {}
    return s;
  };
  return (try1(r.donor_diagnoses) || try1(r.specimen_diagnoses) || try1(r.unstructured_pathology)).slice(0, 90);
}

