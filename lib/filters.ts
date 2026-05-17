import crypto from "node:crypto";
import { resolveMany, resolveOne } from "./synonyms";

export type SpecimenFilters = {
  indication?: string[];
  specimen_types?: string[];
  anatomy?: string[];
  preservation?: string | string[];   // accept array (LLM may pass multiple) or single
  treatment_status?: "naive" | "any" | "post";
  age_range?: [number | null, number | null];
  countries?: string[];
  matched_pairs_required?: boolean;
  longitudinal?: boolean;
  has_contact_email?: boolean;
  min_n?: number | null;
  free_text?: string;
  display_grouping?: "country" | "specimen_type" | "treatment_status" | null;
};

const ARRAY_FIELDS = ["indication", "specimen_types", "anatomy", "countries"] as const;

const FIELD_TO_SYNONYM_KEY: Record<string, string> = {
  indication: "indication",
  specimen_types: "specimen_type",
  anatomy: "anatomy",
  countries: "country",
  preservation: "preservation",
  treatment_status: "treatment_status",
};

/** Apply synonym resolution + lowercase + trim across all filter fields. */
export function canonicalize(f: SpecimenFilters): SpecimenFilters {
  const out: SpecimenFilters = {};
  for (const k of ARRAY_FIELDS) {
    if (f[k]?.length) {
      out[k] = resolveMany(FIELD_TO_SYNONYM_KEY[k], f[k]!).sort();
    }
  }
  if (f.preservation) {
    const list = Array.isArray(f.preservation) ? f.preservation : [f.preservation];
    const resolved = Array.from(new Set(list.map((v) => resolveOne("preservation", v)))).sort();
    out.preservation = resolved.length === 1 ? resolved[0] : resolved;
  }
  if (f.treatment_status) out.treatment_status = resolveOne("treatment_status", f.treatment_status) as SpecimenFilters["treatment_status"];
  if (f.age_range) out.age_range = f.age_range;
  if (typeof f.matched_pairs_required === "boolean") out.matched_pairs_required = f.matched_pairs_required;
  if (typeof f.longitudinal === "boolean") out.longitudinal = f.longitudinal;
  if (typeof f.has_contact_email === "boolean") out.has_contact_email = f.has_contact_email;
  if (f.min_n != null) out.min_n = f.min_n;
  if (f.free_text) out.free_text = f.free_text.trim().toLowerCase();
  if (f.display_grouping) out.display_grouping = f.display_grouping;
  return out;
}

/** Merge a delta on top of a base. Arrays replace; scalars override; undefined skipped.
 *  This is intentionally simple — the LLM passes only what changes; we trust it. */
export function mergeDelta(base: SpecimenFilters | undefined, delta: SpecimenFilters): SpecimenFilters {
  const out: SpecimenFilters = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(delta)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (out as any)[k] = v;
  }
  return out;
}

/** Stable signature: sorted keys, sorted array values, JSON.stringify, SHA1, 12 hex chars.
 *  display_grouping is excluded — it's a projection hint, not a filter,
 *  so "group by country" returns the same slot key as the prior call. */
export function signature(f: SpecimenFilters): string {
  const c = canonicalize(f);
  delete c.display_grouping;
  const sorted: any = {};
  for (const k of Object.keys(c).sort()) sorted[k] = (c as any)[k];
  const json = JSON.stringify(sorted);
  return crypto.createHash("sha1").update(json).digest("hex").slice(0, 12);
}

export function slotKey(tool: string, f: SpecimenFilters): string {
  return `${tool}:${signature(f)}`;
}
