import fs from "node:fs";
import path from "node:path";

export type Org = {
  organization_id: string;
  name: string;
  contact_email: string | null;
  website: string | null;
  address: string | null;
  description: string | null;
  specimen_count: number;
  in_profiles: boolean;
};

let cached: Record<string, Org> | null = null;

export function orgs(): Record<string, Org> {
  if (cached) return cached;
  const p = path.join(process.cwd(), "data", "enriched", "orgs.json");
  const raw: Record<string, Org> = JSON.parse(fs.readFileSync(p, "utf-8"));
  // Sanitize descriptions once on load — strip emoji, marketing bullets, collapse to one calm paragraph.
  for (const id of Object.keys(raw)) {
    raw[id].description = cleanDescription(raw[id].description);
  }
  cached = raw;
  return cached!;
}

/** Clean LinkedIn / marketing copy: drop emoji + checkmark glyphs, collapse whitespace,
 *  trim trailing CTA-style sentences, cap length. Keep first 1–2 substantive sentences. */
export function cleanDescription(s: string | null): string | null {
  if (!s) return null;
  // Strip Unicode emojis and symbols (extended pictographic + misc symbols)
  let out = s.replace(/\p{Extended_Pictographic}/gu, "");
  // Drop common decorative bullets / checkmarks not always classed as pictographic
  out = out.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}]/gu, "");
  // Strip "Looking for...", "Our mission:", "Our services include:", and similar marketing leads
  out = out.replace(/(?:^|\.\s*)(Looking for[^.]+\.)/gi, " ");
  out = out.replace(/(?:^|\.\s*)(Our (?:mission|services include|approach is)[^.]+\.)/gi, " ");
  // Collapse whitespace
  out = out.replace(/\s+/g, " ").trim();
  // Cap at first 240 chars at a sentence boundary
  if (out.length > 240) {
    const cut = out.slice(0, 240);
    const lastDot = cut.lastIndexOf(".");
    out = (lastDot > 80 ? cut.slice(0, lastDot + 1) : cut.trimEnd() + "…");
  }
  return out || null;
}

/** Country labels stay text-only — no emojis (intentional aesthetic call). */
export function flag(country: string | null | undefined): string {
  return country ?? "—";
}
