import { db } from "../db";
import { orgs, flag } from "../orgs";
import { canonicalize, type SpecimenFilters } from "../filters";

export type SpecimenRow = {
  specimen_id: string;
  donor_id: string | null;
  organization_id: string | null;
  specimen_type: string | null;
  preservation_category: string | null;
  age: number | null;
  sex: string | null;
  country: string | null;
  source_site: string | null;
  raw_anatomy: string | null;
  year: number | null;
  unstructured_pathology: string | null;
  donor_diagnoses: string | null;
  specimen_diagnoses: string | null;
  // Enriched from raw_json
  external_specimen_id?: string | null;
  external_donor_id?: string | null;
  donor_race?: string | null;
  preservation_detail?: string | null;
  storage_temp?: string | null;
  // Structured measurements
  tnm?: { T: string | null; N: string | null; M: string | null } | null;
  grade?: string | null;
  stage?: string | null;
  tumor_percentage?: number | null;
  viable_tissue_percentage?: number | null;
  // Donor / specimen TA scores (oncological etc.)
  ta_oncological?: number | null;
  ta_neurological?: number | null;
  // Treatment
  treatment_status?: "naive" | "post" | "unknown";
  treatment_summary?: string | null;
  // Match flags computed against the user's filter
  match_flags?: {
    indication: boolean;
    specimen_type: boolean;
    preservation: boolean;
    anatomy: boolean;
    age: boolean;
    has_donor: boolean;
  };
  // Full raw_json passthrough — surfaced in the drawer for trust.
  // Heavy; only attach for sample rows we render, not for arbitrary scans.
  raw?: any;
};

export type InstituteEntry = {
  organization_id: string;
  name: string;
  country: string | null;
  flag: string;
  contact_email: string | null;
  website: string | null;
  description: string | null;
  in_profiles: boolean;
  match_score: number;
  specimen_count: number;
  donor_count: number;
  longitudinal_donor_count: number;
  matched_pair_donor_count: number;
  by_specimen_type: Record<string, number>;
  sample_rows: SpecimenRow[];
};

export type Gap = {
  kind: "thin_results" | "no_contact_email" | "below_min_n" | "no_longitudinal" | "no_matched_pairs" | "low_specimen_count" | "no_curated_evidence";
  why: string;
  actions: { label: string; intent: string }[];
};

export type QuerySpecimensResult = {
  filters_applied: SpecimenFilters;
  totals: {
    specimens: number;
    donors: number;
    institutes: number;
    longitudinal_donors: number;
  };
  institutes: InstituteEntry[];
  /** Flat table view: enriched rows from across all institutes, capped at TABLE_SAMPLE. */
  table_rows: SpecimenRow[];
  groupings: {
    by_country: Record<string, { count: number; institutes: string[] }>;
    by_specimen_type: Record<string, number>;
    by_treatment_status: Record<string, number>;
  };
  gaps: Gap[];
};

const SPECIMEN_TYPE_DEFAULT_LIMIT = 5000; // hard cap on full-row scan
const PER_ORG_SAMPLE = 24;
const TABLE_SAMPLE = 200; // flat table covers up to N matching rows across all orgs

/** Fetch raw_json for a set of specimens and merge enriched fields into SpecimenRow.
 *  Mutates the rows in place. */
function enrichWithRawJson(rows: SpecimenRow[], filters: SpecimenFilters): void {
  if (rows.length === 0) return;
  const conn = db();
  const ids = rows.map((r) => r.specimen_id);
  // src.specimens.specimen_id has index `idx_specimen_id`; chunk to avoid SQL var limit (~999).
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 800) chunks.push(ids.slice(i, i + 800));
  const byId = new Map<string, any>();
  for (const ch of chunks) {
    const placeholders = ch.map(() => "?").join(",");
    const rs = conn.prepare(
      `SELECT specimen_id, donor_id, raw_json FROM src.specimens WHERE specimen_id IN (${placeholders})`
    ).all(...ch) as { specimen_id: string; donor_id: string | null; raw_json: string }[];
    for (const r of rs) {
      // pick any matching specimen_id; for non-unique specimen_id we accept the first
      if (!byId.has(r.specimen_id)) byId.set(r.specimen_id, r);
    }
  }
  for (const row of rows) {
    const hit = byId.get(row.specimen_id);
    if (!hit) continue;
    let parsed: any = {};
    try { parsed = JSON.parse(hit.raw_json); } catch {}
    const sm = parsed.structured_measurements ?? {};
    row.external_specimen_id = parsed.external_ids?.specimen_id ?? null;
    row.external_donor_id = parsed.external_ids?.donor_id ?? null;
    row.donor_race = parsed.donor_race ?? null;
    row.preservation_detail = parsed.unstructured_preservation ?? null;
    row.storage_temp = extractStorageTemp(parsed.unstructured_preservation, parsed.unstructured_clinical_data);
    row.tnm = (sm.T || sm.N || sm.M) ? { T: sm.T ?? null, N: sm.N ?? null, M: sm.M ?? null } : null;
    row.grade = sm.grade ?? null;
    row.stage = sm.stage ?? null;
    row.tumor_percentage = numOrNull(sm.tumor_percentage);
    row.viable_tissue_percentage = numOrNull(sm.viable_tissue_percentage);
    row.ta_oncological = numOrNull(parsed.specimen_tas?.Oncological ?? parsed.donor_tas?.Oncological);
    row.ta_neurological = numOrNull(parsed.specimen_tas?.Neurological ?? parsed.donor_tas?.Neurological);
    row.treatment_status = parseTreatmentStatus(parsed.unstructured_treatments);
    row.treatment_summary = (parsed.unstructured_treatments ?? null)?.toString().slice(0, 200) ?? null;
    row.match_flags = computeMatchFlags(row, filters);
    row.raw = parsed;
  }
}

function numOrNull(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractStorageTemp(...sources: (string | null | undefined)[]): string | null {
  for (const s of sources) {
    if (!s) continue;
    const m = s.match(/-?\s?80\s?°?C|\bLN2\b|\bln\s?2\b|\b-20\s?°?C/i);
    if (m) return m[0].toUpperCase().replace(/\s+/g, "");
  }
  return null;
}

function parseTreatmentStatus(s: string | null | undefined): "naive" | "post" | "unknown" {
  if (!s) return "unknown";
  const t = s.toLowerCase();
  if (/treatment-naive|treatment naive|untreated|pre-treatment|naive/.test(t)) return "naive";
  if (/post[- ]treatment|on therapy|after therapy/.test(t)) return "post";
  if (/chemotherapy indicator: yes|radiation therapy indicator: yes/.test(t)) return "post";
  if (/chemotherapy indicator: no/.test(t) && /radiation therapy indicator: no/.test(t)) return "naive";
  return "unknown";
}

function computeMatchFlags(row: SpecimenRow, f: SpecimenFilters): SpecimenRow["match_flags"] {
  const wantInd = (f.indication ?? []).map((s) => s.toLowerCase());
  const wantTypes = (f.specimen_types ?? []);
  const wantAnat = (f.anatomy ?? []).map((s) => s.toLowerCase());
  const wantPres = Array.isArray(f.preservation) ? f.preservation : f.preservation ? [f.preservation] : [];
  const dxBlob = (row.donor_diagnoses ?? "") + " " + (row.specimen_diagnoses ?? "") + " " + (row.unstructured_pathology ?? "");
  const dxLower = dxBlob.toLowerCase();
  const anatBlob = ((row.raw_anatomy ?? "") + " " + (row.source_site ?? "")).toLowerCase();
  return {
    indication: wantInd.length ? wantInd.some((w) => dxLower.includes(w)) : true,
    specimen_type: wantTypes.length ? !!row.specimen_type && wantTypes.includes(row.specimen_type) : true,
    preservation: wantPres.length ? !!row.preservation_category && wantPres.includes(row.preservation_category) : true,
    anatomy: wantAnat.length ? wantAnat.some((w) => anatBlob.includes(w)) : true,
    age: f.age_range ? rangeMatch(row.age, f.age_range) : true,
    has_donor: !!row.donor_id,
  };
}

function rangeMatch(v: number | null, range: [number | null, number | null]): boolean {
  if (v == null) return false;
  if (range[0] != null && v < range[0]) return false;
  if (range[1] != null && v > range[1]) return false;
  return true;
}

function quoteFts(s: string): string {
  // Always wrap in double quotes — FTS5 treats unquoted hyphens as column
  // qualifiers (e.g. "node-positive" → "no such column: positive"). Quoting
  // forces phrase semantics so anything goes through verbatim.
  const cleaned = s.replace(/[^a-z0-9 \-']/gi, " ").trim();
  if (!cleaned) return "";
  return `"${cleaned}"`;
}

function buildWhere(f: SpecimenFilters): { sql: string; params: any[]; ftsMatch: string | null } {
  const conds: string[] = [];
  const params: any[] = [];
  let ftsMatch: string | null = null;

  // FTS5: each term-group internally OR'd (synonyms within one concept), groups AND'd.
  // Free_text is only used as a fallback when no indication/anatomy could be extracted —
  // otherwise the user's literal sentence over-constrains the match.
  const indSub = (f.indication ?? []).map((i) => quoteFts(i)).filter(Boolean).join(" OR ");
  const anatSub = (f.anatomy ?? []).map((a) => quoteFts(a)).filter(Boolean).join(" OR ");
  const ftsGroups: string[] = [];
  if (indSub) ftsGroups.push(`(${indSub})`);
  if (anatSub) ftsGroups.push(`(${anatSub})`);
  if (!indSub && !anatSub && f.free_text) {
    const ft = f.free_text.replace(/[^a-z0-9 ]/gi, " ").trim();
    if (ft) ftsGroups.push(ft);
  }
  if (ftsGroups.length) ftsMatch = ftsGroups.join(" AND ");

  if (f.specimen_types?.length) {
    conds.push(`s.specimen_type IN (${f.specimen_types.map(() => "?").join(",")})`);
    params.push(...f.specimen_types);
  }
  if (f.preservation) {
    const pres = Array.isArray(f.preservation) ? f.preservation : [f.preservation];
    if (pres.length === 1) {
      conds.push(`s.preservation_category = ?`);
      params.push(pres[0]);
    } else {
      conds.push(`s.preservation_category IN (${pres.map(() => "?").join(",")})`);
      params.push(...pres);
    }
  }
  if (f.countries?.length) {
    conds.push(`s.country IN (${f.countries.map(() => "?").join(",")})`);
    params.push(...f.countries);
  }
  if (f.age_range) {
    const [lo, hi] = f.age_range;
    if (lo != null) { conds.push(`s.age >= ?`); params.push(lo); }
    if (hi != null) { conds.push(`s.age <= ?`); params.push(hi); }
  }
  if (f.treatment_status === "naive") {
    conds.push(`(s.unstructured_treatments LIKE '%aive%' OR s.unstructured_treatments LIKE '%untreated%')`);
  }
  return { sql: conds.join(" AND "), params, ftsMatch };
}

function matchScore(f: SpecimenFilters, by_type: Record<string, number>, total: number, contact: string | null): number {
  // Simple heuristic: total specimen count, boosted by specimen-type overlap, mild penalty if no contact.
  let s = Math.log10(total + 1);
  for (const t of f.specimen_types ?? []) if (by_type[t]) s += 0.4;
  if (!contact) s -= 0.2;
  return Math.round(s * 100) / 100;
}

export function queryspecimens(rawFilters: SpecimenFilters): QuerySpecimensResult {
  const f = canonicalize(rawFilters);
  const conn = db();
  const { sql: whereSql, params, ftsMatch } = buildWhere(f);

  // Build base specimens query
  let fromClause = `FROM specimen_join_keys s`;
  const fullParams: any[] = [];
  if (ftsMatch) {
    fromClause += ` JOIN specimens_fts f ON f.specimen_id = s.specimen_id`;
  }
  if (f.longitudinal) {
    fromClause += ` JOIN donor_longitudinal d ON d.donor_id = s.donor_id`;
  }
  const where: string[] = [];
  if (ftsMatch) {
    where.push(`f.haystack MATCH ?`);
    fullParams.push(ftsMatch);
  }
  if (whereSql) {
    where.push(whereSql);
    fullParams.push(...params);
  }
  if (f.longitudinal) {
    where.push(`d.n_distinct_years >= 2`);
  }
  if (f.has_contact_email) {
    // join orgs in JS; we filter post-hoc
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // Totals
  const totalsRow = conn.prepare(
    `SELECT COUNT(*) AS n_specimens, COUNT(DISTINCT s.donor_id) AS n_donors,
            COUNT(DISTINCT s.organization_id) AS n_orgs ${fromClause} ${whereClause}`
  ).get(...fullParams) as { n_specimens: number; n_donors: number; n_orgs: number };

  // Per-org rollup
  const perOrg = conn.prepare(
    `SELECT s.organization_id, s.specimen_type,
            COUNT(*) AS n,
            COUNT(DISTINCT s.donor_id) AS n_donors
     ${fromClause} ${whereClause}
     GROUP BY s.organization_id, s.specimen_type`
  ).all(...fullParams) as { organization_id: string; specimen_type: string; n: number; n_donors: number }[];

  // Sample rows: bias to recent + diverse types per org
  const sampleRowsAll = conn.prepare(
    `SELECT s.specimen_id, s.donor_id, s.organization_id, s.specimen_type,
            s.preservation_category, s.age, s.sex, s.country, s.source_site, s.raw_anatomy, s.year,
            s.unstructured_pathology, s.donor_diagnoses, s.specimen_diagnoses
     ${fromClause} ${whereClause}
     ORDER BY s.year DESC NULLS LAST
     LIMIT ${SPECIMEN_TYPE_DEFAULT_LIMIT}`
  ).all(...fullParams) as SpecimenRow[];

  // Group rollup by org
  const orgsMap = orgs();
  const orgAgg = new Map<string, { specimens: number; donorSet: Set<string>; byType: Record<string, number> }>();
  for (const r of perOrg) {
    if (!r.organization_id) continue;
    const a = orgAgg.get(r.organization_id) || { specimens: 0, donorSet: new Set(), byType: {} };
    a.specimens += r.n;
    a.byType[r.specimen_type ?? "Other"] = (a.byType[r.specimen_type ?? "Other"] ?? 0) + r.n;
    orgAgg.set(r.organization_id, a);
  }
  // Donor sets via separate query (cheap since already filtered)
  const donorRows = conn.prepare(
    `SELECT DISTINCT s.organization_id, s.donor_id ${fromClause} ${whereClause}`
  ).all(...fullParams) as { organization_id: string; donor_id: string }[];
  for (const dr of donorRows) {
    if (!dr.organization_id) continue;
    const a = orgAgg.get(dr.organization_id);
    if (a && dr.donor_id) a.donorSet.add(dr.donor_id);
  }

  // Longitudinal donor counts per org
  const longitudinalDonorByOrg = new Map<string, number>();
  if (donorRows.length) {
    const placeholders = donorRows.slice(0, 50000).map(() => "?").join(",");
    if (placeholders) {
      const ldRows = conn.prepare(
        `SELECT s.organization_id, COUNT(DISTINCT s.donor_id) AS n
         FROM specimen_join_keys s
         JOIN donor_longitudinal d ON d.donor_id = s.donor_id
         WHERE s.donor_id IN (${placeholders}) AND d.n_distinct_years >= 2
         GROUP BY s.organization_id`
      ).all(...donorRows.slice(0, 50000).map((r) => r.donor_id)) as { organization_id: string; n: number }[];
      for (const r of ldRows) if (r.organization_id) longitudinalDonorByOrg.set(r.organization_id, r.n);
    }
  }

  // One-shot: most common country per org in a single FTS query (vs per-org loop).
  const countryRows = conn.prepare(
    `SELECT s.organization_id, s.country, COUNT(*) AS n ${fromClause} ${whereClause}
     GROUP BY s.organization_id, s.country`,
  ).all(...fullParams) as { organization_id: string; country: string | null; n: number }[];
  const countryByOrg = new Map<string, string | null>();
  const countryWinByOrg = new Map<string, number>();
  for (const r of countryRows) {
    if (!r.organization_id) continue;
    const cur = countryWinByOrg.get(r.organization_id) ?? 0;
    if (r.n > cur) {
      countryWinByOrg.set(r.organization_id, r.n);
      countryByOrg.set(r.organization_id, r.country);
    }
  }

  // Build institute entries
  let institutes: InstituteEntry[] = [];
  for (const [orgId, agg] of orgAgg.entries()) {
    const meta = orgsMap[orgId];
    if (!meta) continue;
    const country = countryByOrg.get(orgId) ?? null;
    if (f.has_contact_email && !meta.contact_email) continue;
    const score = matchScore(f, agg.byType, agg.specimens, meta.contact_email);
    institutes.push({
      organization_id: orgId,
      name: meta.name,
      country,
      flag: flag(country),
      contact_email: meta.contact_email,
      website: meta.website,
      description: meta.description,
      in_profiles: meta.in_profiles,
      match_score: score,
      specimen_count: agg.specimens,
      donor_count: agg.donorSet.size,
      longitudinal_donor_count: longitudinalDonorByOrg.get(orgId) ?? 0,
      matched_pair_donor_count: 0, // TODO: real matched-pair compute (defer)
      by_specimen_type: agg.byType,
      sample_rows: sampleRowsAll.filter((r) => r.organization_id === orgId).slice(0, PER_ORG_SAMPLE),
    });
  }
  institutes.sort((a, b) => b.match_score - a.match_score);
  institutes = institutes.slice(0, 12);

  // Enrich the SAMPLE rows for each surviving institute, then drop rows that don't truly match.
  const enrichTargets: SpecimenRow[] = [];
  for (const inst of institutes) enrichTargets.push(...inst.sample_rows);
  enrichWithRawJson(enrichTargets, f);

  // Honest filter: a row only shows if it hits each filter the user specified.
  const wantsInd = !!(f.indication?.length);
  const wantsType = !!(f.specimen_types?.length);
  const wantsPres = !!f.preservation;
  const wantsAnat = !!(f.anatomy?.length);
  const isMatching = (r: SpecimenRow): boolean => {
    const fl = r.match_flags;
    if (!fl) return false;
    if (wantsInd && !fl.indication) return false;
    if (wantsType && !fl.specimen_type) return false;
    if (wantsPres && !fl.preservation) return false;
    if (wantsAnat && !fl.anatomy) return false;
    return true;
  };
  for (const inst of institutes) {
    inst.sample_rows = inst.sample_rows.filter(isMatching);
  }
  // Drop institutes that ended up with zero truly-matching rows (the FTS broad-match got them in but nothing actually hit the filters).
  institutes = institutes.filter((i) => i.sample_rows.length > 0);

  // Build table_rows from filtered rows, round-robin across institutes.
  const buckets = institutes.map((i) => [...i.sample_rows]);
  const tableRows: SpecimenRow[] = [];
  while (tableRows.length < TABLE_SAMPLE) {
    let added = 0;
    for (const b of buckets) {
      if (b.length === 0) continue;
      tableRows.push(b.shift()!);
      added++;
      if (tableRows.length >= TABLE_SAMPLE) break;
    }
    if (added === 0) break;
  }

  // Groupings
  const by_country: Record<string, { count: number; institutes: string[] }> = {};
  for (const i of institutes) {
    const k = i.country ?? "—";
    by_country[k] = by_country[k] || { count: 0, institutes: [] };
    by_country[k].count += i.specimen_count;
    by_country[k].institutes.push(i.name);
  }
  const by_specimen_type: Record<string, number> = {};
  for (const r of perOrg) by_specimen_type[r.specimen_type ?? "Other"] = (by_specimen_type[r.specimen_type ?? "Other"] ?? 0) + r.n;
  const by_treatment_status: Record<string, number> = { any: totalsRow.n_specimens };

  // Gaps
  const gaps: Gap[] = [];
  if (totalsRow.n_specimens === 0) {
    gaps.push({
      kind: "thin_results",
      why: "No specimens matched these filters in the commercial catalog.",
      actions: [
        { label: "Commission broader sourcing", intent: "open_request_form:source_wider" },
        { label: "Search literature", intent: "find_publications" },
      ],
    });
  } else {
    if (totalsRow.n_specimens < 50) {
      gaps.push({
        kind: "low_specimen_count",
        why: `Only ${totalsRow.n_specimens} specimens across ${totalsRow.n_orgs} orgs — thin for most studies.`,
        actions: [{ label: "Commission broader sourcing", intent: "open_request_form:source_wider" }],
      });
    }
    if (f.min_n != null && totalsRow.n_specimens < f.min_n) {
      gaps.push({
        kind: "below_min_n",
        why: `Found ${totalsRow.n_specimens} but you asked for ≥${f.min_n}. Commercial catalog is short.`,
        actions: [{ label: "Commission to fill gap", intent: "open_request_form:source_wider" }],
      });
    }
    const noContact = institutes.filter((i) => !i.contact_email).length;
    if (noContact > 0) {
      gaps.push({
        kind: "no_contact_email",
        why: `${noContact} institute${noContact === 1 ? "" : "s"} without a contact email — direct outreach blocked.`,
        actions: [{ label: "Drop these", intent: "filter:has_contact_email=true" }],
      });
    }
    if (f.longitudinal && institutes.every((i) => i.longitudinal_donor_count === 0)) {
      gaps.push({
        kind: "no_longitudinal",
        why: "No institutes have donors with multi-year longitudinal collections.",
        actions: [{ label: "Commission a longitudinal cohort", intent: "open_request_form:source_wider" }],
      });
    }
  }

  return {
    filters_applied: f,
    totals: {
      specimens: totalsRow.n_specimens,
      donors: totalsRow.n_donors,
      institutes: institutes.length,
      longitudinal_donors: institutes.reduce((s, i) => s + i.longitudinal_donor_count, 0),
    },
    institutes,
    table_rows: tableRows,
    groupings: { by_country, by_specimen_type, by_treatment_status },
    gaps,
  };
}

