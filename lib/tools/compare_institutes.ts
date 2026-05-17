import { db } from "../db";
import { orgs, flag } from "../orgs";

export type ComparisonRow = {
  organization_id: string;
  name: string;
  country: string | null;
  flag: string;
  contact_email: string | null;
  website: string | null;
  specimen_count: number;
  donor_count: number;
  longitudinal_donor_count: number;
  by_specimen_type: Record<string, number>;
};

export type CompareInstitutesResult = {
  institute_ids: string[];
  rows: ComparisonRow[];
};

export function compareinstitutes(institute_ids: string[]): CompareInstitutesResult {
  const conn = db();
  const orgsMap = orgs();
  const placeholders = institute_ids.map(() => "?").join(",");
  if (!institute_ids.length) return { institute_ids, rows: [] };

  const counts = conn.prepare(
    `SELECT organization_id, specimen_type, COUNT(*) AS n
     FROM specimen_join_keys
     WHERE organization_id IN (${placeholders})
     GROUP BY organization_id, specimen_type`
  ).all(...institute_ids) as { organization_id: string; specimen_type: string; n: number }[];

  const donorCounts = conn.prepare(
    `SELECT organization_id, COUNT(DISTINCT donor_id) AS n
     FROM specimen_join_keys
     WHERE organization_id IN (${placeholders})
     GROUP BY organization_id`
  ).all(...institute_ids) as { organization_id: string; n: number }[];

  const longCounts = conn.prepare(
    `SELECT s.organization_id, COUNT(DISTINCT s.donor_id) AS n
     FROM specimen_join_keys s
     JOIN donor_longitudinal d ON d.donor_id = s.donor_id
     WHERE s.organization_id IN (${placeholders}) AND d.n_distinct_years >= 2
     GROUP BY s.organization_id`
  ).all(...institute_ids) as { organization_id: string; n: number }[];

  const countries = conn.prepare(
    `SELECT organization_id, country, COUNT(*) AS n
     FROM specimen_join_keys
     WHERE organization_id IN (${placeholders})
     GROUP BY organization_id, country`
  ).all(...institute_ids) as { organization_id: string; country: string; n: number }[];

  const rows: ComparisonRow[] = institute_ids.map((id) => {
    const meta = orgsMap[id];
    const byType: Record<string, number> = {};
    let total = 0;
    for (const r of counts) if (r.organization_id === id) { byType[r.specimen_type] = r.n; total += r.n; }
    const donor = donorCounts.find((r) => r.organization_id === id)?.n ?? 0;
    const long = longCounts.find((r) => r.organization_id === id)?.n ?? 0;
    const ctyRows = countries.filter((r) => r.organization_id === id).sort((a, b) => b.n - a.n);
    const country = ctyRows[0]?.country ?? null;
    return {
      organization_id: id,
      name: meta?.name ?? `Unknown (${id.slice(0, 8)})`,
      country,
      flag: flag(country),
      contact_email: meta?.contact_email ?? null,
      website: meta?.website ?? null,
      specimen_count: total,
      donor_count: donor,
      longitudinal_donor_count: long,
      by_specimen_type: byType,
    };
  });

  return { institute_ids, rows };
}
