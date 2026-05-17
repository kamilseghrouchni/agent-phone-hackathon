import fs from "node:fs";
import path from "node:path";

type SynonymMap = Record<string, Record<string, string>>;

let cached: SynonymMap | null = null;

function load(): SynonymMap {
  if (cached) return cached;
  const p = path.join(process.cwd(), "data", "enriched", "synonyms.json");
  cached = JSON.parse(fs.readFileSync(p, "utf-8"));
  return cached!;
}

/** Resolve a single value against a field's synonym table. Lowercases input,
 *  trims whitespace, falls back to original (lowercased) if not in map. */
export function resolveOne(field: string, value: string): string {
  const map = load()[field];
  const key = value.trim().toLowerCase();
  if (!map) return key;
  return map[key] ?? key;
}

export function resolveMany(field: string, values: string[]): string[] {
  return Array.from(new Set(values.map((v) => resolveOne(field, v))));
}
