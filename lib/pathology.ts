export type PathologySection = { label: string; value: string };

export type PathologyMeasurements = {
  tumor_size?: string;
  clark_level?: string;
  breslow_depth?: string;
  pT?: string;
  pN?: string;
  pM?: string;
  lvi?: string;
  pni?: string;
  resection_margin?: string;
  icd_o_code?: string;
};

export type SerologyResult = { agent: string; result: string };

export type ParsedPathology = {
  sections: PathologySection[];
  measurements: PathologyMeasurements;
  concomitant_diseases?: string[];
  serologies?: SerologyResult[];
  raw: string;
};

const KNOWN_HEADERS = [
  "Main Diagnosis and Complications",
  "Pathology Report",
  "Histopathological Diagnosis",
  "Concomitant Diseases",
  "Treatment of Concomitant Diseases",
  "Cancer History and Relapses",
  "COVID-19 Vaccination",
  "HIV, HCV, HBsAg, Syphilis",
];

/** Strip enumeration markers like " (1)", "(2)" that some sources prepend/append to section labels. */
function normalizeLabel(label: string): string {
  return label.replace(/\s*\(\s*\d+\s*\)\s*$/, "").trim();
}

function isLikelyHeader(label: string): boolean {
  const t = normalizeLabel(label);
  if (t.length < 3 || t.length > 80) return false;
  if (KNOWN_HEADERS.some((h) => h.toLowerCase() === t.toLowerCase())) return true;
  // Title-case-ish: first char upper, doesn't contain typical mid-sentence cues.
  if (!/^[A-Z]/.test(t)) return false;
  if (/\bof\s|\bin\s/.test(t.toLowerCase()) && t.split(" ").length > 6) return false;
  return /^[A-Z][A-Za-z0-9 ,\-]{1,79}$/.test(t);
}

export function parsePathologyNotes(input: string | null | undefined): ParsedPathology | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  const chunks = raw.split(";").map((c) => c.trim()).filter(Boolean);
  const sections: PathologySection[] = [];
  for (const chunk of chunks) {
    const m = chunk.match(/^([^:]{2,80}?)\s*:\s*(.*)$/s);
    if (m && isLikelyHeader(m[1])) {
      sections.push({ label: normalizeLabel(m[1]), value: m[2].trim() });
    } else if (sections.length > 0) {
      sections[sections.length - 1].value += "; " + chunk;
    } else {
      sections.push({ label: "Notes", value: chunk });
    }
  }

  // Extract structured measurements. Search across narrative sections (Pathology Report,
  // Histopathological Diagnosis, Main Diagnosis) — the staging tokens can land in any of them.
  const measurements: PathologyMeasurements = {};
  const narrative = sections
    .filter((s) => /(pathology report|histopathological diagnosis|main diagnosis)/i.test(s.label))
    .map((s) => s.value)
    .join(" \n ");
  if (narrative) {
    const sizeM = narrative.match(/tumor\s*size\s*:?\s*([\d.]+\s*(?:cm|mm)[^,.;]*)/i);
    if (sizeM) measurements.tumor_size = sizeM[1].trim();

    const clarkM = narrative.match(/clark\s+level\s+([IVX]+|\d+)/i);
    if (clarkM) measurements.clark_level = clarkM[1].toUpperCase();

    const breslowMm = narrative.match(/breslow[^()]*\(([\d.]+\s*mm)\)/i);
    const breslowRoman = narrative.match(/breslow\s*depth\s+([IVX]+|\d+)/i);
    if (breslowMm && breslowRoman) {
      measurements.breslow_depth = `${breslowRoman[1].toUpperCase()} (${breslowMm[1]})`;
    } else if (breslowMm) {
      measurements.breslow_depth = breslowMm[1];
    } else if (breslowRoman) {
      measurements.breslow_depth = breslowRoman[1].toUpperCase();
    }

    // Pathological TNM: pT4b / pN1 / pNx / pM0 — also bare T/N/M when prefixed by a paren.
    const ptM = narrative.match(/\bp?T(\d[a-d]?|is|x)\b/i);
    if (ptM) measurements.pT = `T${ptM[1].toLowerCase().replace(/x/, "x")}`;
    const pnM = narrative.match(/\bp?N(\d[a-d]?|x)\b/i);
    if (pnM) measurements.pN = `N${pnM[1].toLowerCase()}`;
    const pmM = narrative.match(/\bp?M(\d[a-d]?|x)\b/i);
    if (pmM) measurements.pM = `M${pmM[1].toLowerCase()}`;

    // LVI = lymphovascular invasion. LVI1 = present, LVI0 = absent.
    const lviM = narrative.match(/\bLVI\s*([01x])\b/i);
    if (lviM) measurements.lvi = lviM[1] === "1" ? "Present" : lviM[1] === "0" ? "Absent" : "Not assessed";

    // Pn = perineural invasion. Pn1 = present, Pn0 = absent.
    const pniM = narrative.match(/\bPn\s*([01x])\b/i);
    if (pniM) measurements.pni = pniM[1] === "1" ? "Present" : pniM[1] === "0" ? "Absent" : "Not assessed";

    // R-status = residual tumor at margin. R0 = clear, R1 = microscopic, R2 = macroscopic.
    const rM = narrative.match(/\bR\s*([012x])\b/);
    if (rM) {
      const map: Record<string, string> = {
        "0": "R0 (clear margin)",
        "1": "R1 (microscopic residual)",
        "2": "R2 (macroscopic residual)",
        "x": "Rx (cannot assess)",
      };
      measurements.resection_margin = map[rM[1].toLowerCase()] ?? `R${rM[1]}`;
    }

    // ICD-O code (morphology/topography), e.g. 8743/3.
    const icdM = narrative.match(/ICD[- ]?O[^0-9]{0,12}(\d{4}\/\d)/i);
    if (icdM) measurements.icd_o_code = icdM[1];
  }

  // Concomitant diseases as a list.
  let concomitant_diseases: string[] | undefined;
  const concSec = sections.find((s) => /^concomitant diseases$/i.test(s.label));
  if (concSec?.value) {
    concomitant_diseases = concSec.value
      .split(/,| and /i)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  // Expand the serology list ("HIV, HCV, HBsAg, Syphilis: Negative") into per-agent rows.
  let serologies: SerologyResult[] | undefined;
  const seroSec = sections.find((s) => /,/.test(s.label) && /(hiv|hcv|hbsag|syphilis)/i.test(s.label));
  if (seroSec) {
    const agents = seroSec.label.split(",").map((a) => a.trim()).filter(Boolean);
    const result = seroSec.value.trim();
    serologies = agents.map((agent) => ({ agent, result }));
  }

  return { sections, measurements, concomitant_diseases, serologies, raw };
}

export function diagnosesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (s: string) => s.trim().toLowerCase();
  const aSet = new Set(a.map(norm));
  for (const x of b) if (!aSet.has(norm(x))) return false;
  return true;
}
