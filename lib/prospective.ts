import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ProspectiveLayer1 = {
  programName: string;
  steward: string;
  poolSize: string;
  activityProof: string;
  reuseProof: string;
  specimenDepth: string;
  accessPath: string;
  sourcesNote: string;
};

export type MatchedSignal = {
  area: string;       // short area label, e.g. "Movement disorders"
  fact: string;       // single line: did-it-before + has-the-population
};

export type ProspectiveCard = {
  id: string;
  institution: string;
  shortLabel: string;
  location: string;
  probeState: string;
  buyerQuery: string;
  layer1: ProspectiveLayer1;
  layer2Markdown: string;
  matched?: MatchedSignal | null;
};

type CardSpec = {
  id: string;
  file: string;
  shortLabel: string;
  location: string;
  probeState: string;
};

const SPECS: CardSpec[] = [
  {
    id: "louisville",
    file: "card-louisville.md",
    shortLabel: "U of Louisville · CAP cohort",
    location: "Louisville, KY",
    probeState: "Own bank · own steward · reuse proven",
  },
  {
    id: "umc-nola",
    file: "card-umc-nola.md",
    shortLabel: "UMC New Orleans · ClinSeqSer",
    location: "New Orleans, LA",
    probeState: "Clinical host · steward = Tulane",
  },
  {
    id: "evergreen",
    file: "card-evergreen.md",
    shortLabel: "EvergreenHealth · trial portfolio",
    location: "Kirkland, WA",
    probeState: "No local cohort · 38 active trials, 4 stewards",
  },
];

// Per-card proof areas. Each area = a disease/scope where the partner has
// already proven (a) the patient population and (b) prior trial / reuse activity.
// A query has to hit one of these for the card to surface — populations the
// partner has never recruited for are filtered out, no "score 0 fallback".
type ProofArea = {
  area: string;
  keywords: string[];
  fact: string;
};

const PROOF: Record<string, ProofArea[]> = {
  louisville: [
    {
      area: "Community-acquired pneumonia",
      keywords: ["pneumonia", "cap", "respiratory", "lung", "urine", "infectious", "id", "copd", "rsv", "mycoplasma", "pneumococc"],
      fact: "8,284 CAP hospitalizations · 6,196 consented urine biospecimens · multi-omics on stored urine already published (PMC7414893)",
    },
    {
      area: "SARS-CoV-2 / COVID-19",
      keywords: ["covid", "sars-cov-2", "sars cov 2", "sarscov2", "coronavirus"],
      fact: "1,645 SARS-CoV-2 CAP patients · longitudinal CV-event follow-up · same Ramirez group, same access path",
    },
  ],
  "umc-nola": [
    {
      area: "COVID-19 / PASC longitudinal",
      keywords: ["covid", "sars-cov-2", "sars cov 2", "sarscov2", "pasc", "long covid", "longitudinal", "respiratory", "viral", "infectious"],
      fact: "456 acute COVID + 107 PASC longitudinal · Olink 25-marker plasma proteome already run · Black-NH 60.5%",
    },
  ],
  evergreen: [
    {
      area: "Multiple sclerosis (Brown IIT)",
      keywords: ["ms", "multiple sclerosis", "demyelinating", "bladder"],
      fact: "11 single-site MS IIT trials (Brown lab, n=21–43 each) · sponsor-investigator on-site · home-grown EMST-LE instrument",
    },
    {
      area: "Solid-tumor oncology (FHCC satellite)",
      keywords: ["oncology", "tumor", "cancer", "breast", "tnbc", "triple-negative", "prostate", "crc", "colorectal", "lung", "nsclc", "urothelial", "idc", "ductal"],
      fact: "FHCC satellite · Phase 3 NCI co-op recruitment (NCI/SWOG/Alliance/NRG/ECOG-ACRIN/CCTG) — broad solid tumor",
    },
    {
      area: "Movement disorders / neurodegen",
      keywords: ["parkinson", "pd", "movement", "dystonia", "huntington", "lrrk2", "alzheimer", "ad", "lbd", "lewy", "neuro", "neurodegen"],
      fact: "Active Phase 2/3 LRRK2-PD, AAV-GDNF, cell-therapy PD, KarXT AD — Denali, BlueRock, AskBio, Roche, BMS recruiting now",
    },
  ],
};

let cache: ProspectiveCard[] | null = null;

export function loadProspectiveCards(): ProspectiveCard[] {
  if (cache) return cache;
  const dir = join(process.cwd(), "data", "institution-cards");
  cache = SPECS.map((spec) => {
    const md = readFileSync(join(dir, spec.file), "utf8");
    return parseCard(spec, md);
  });
  return cache;
}

function parseCard(spec: CardSpec, md: string): ProspectiveCard {
  const institution = (md.match(/^#\s+(.+)$/m)?.[1] ?? spec.id).trim();
  const buyerQuery = extractBuyerQuery(md);
  const layer1 = extractLayer1(md);
  const layer2Markdown = extractLayer2(md);
  return {
    id: spec.id,
    institution,
    shortLabel: spec.shortLabel,
    location: spec.location,
    probeState: spec.probeState,
    buyerQuery,
    layer1,
    layer2Markdown,
    matched: null,
  };
}

function extractBuyerQuery(md: string): string {
  const sect = sliceBetween(md, /^##\s+Buyer query\s*$/m, /^---\s*$/m);
  if (!sect) return "";
  // Strip leading "> *" markers and surrounding asterisks
  const lines = sect.split("\n").map((l) => l.replace(/^>\s?/, "").trim()).filter(Boolean);
  const joined = lines.join(" ").replace(/^\*"?/, "").replace(/"?\*$/, "").trim();
  return joined.replace(/\s+/g, " ");
}

function extractLayer1(md: string): ProspectiveLayer1 {
  const sect = sliceBetween(md, /^##\s+Layer 1[^\n]*$/m, /^---\s*$/m);
  if (!sect) return emptyLayer1();
  const rows: Record<string, string> = {};
  for (const line of sect.split("\n")) {
    // Match: | **Slot** | Value |
    const m = line.match(/^\|\s*\*\*([^*]+)\*\*\s*\|\s*(.+?)\s*\|\s*$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    rows[key] = m[2].trim();
  }
  return {
    programName: rows["program name"] ?? "",
    steward: rows["steward"] ?? "",
    poolSize: rows["pool size"] ?? "",
    activityProof: rows["activity proof"] ?? "",
    reuseProof: rows["reuse / external-access proof"] ?? "",
    specimenDepth: rows["specimen + data depth"] ?? "",
    accessPath: rows["access path"] ?? "",
    sourcesNote: rows["sources"] ?? "",
  };
}

function extractLayer2(md: string): string {
  const m = md.match(/^##\s+Layer 2[^\n]*$/m);
  if (!m || m.index == null) return "";
  return md.slice(m.index + m[0].length).trim();
}

function sliceBetween(md: string, start: RegExp, end: RegExp): string | null {
  const startMatch = md.match(start);
  if (!startMatch || startMatch.index == null) return null;
  const tail = md.slice(startMatch.index + startMatch[0].length);
  const endMatch = tail.match(end);
  if (!endMatch || endMatch.index == null) return tail.trim();
  return tail.slice(0, endMatch.index).trim();
}

function emptyLayer1(): ProspectiveLayer1 {
  return {
    programName: "",
    steward: "",
    poolSize: "",
    activityProof: "",
    reuseProof: "",
    specimenDepth: "",
    accessPath: "",
    sourcesNote: "",
  };
}

// Filter + match. A card surfaces only when at least one of its proof areas
// has a keyword hit in the query. The highest-scoring area is attached as the
// signal fact. If nothing matches, the card is dropped — no "proven for an
// unrelated population" rows.
//
// Keywords match on word boundaries so short tokens (ms, pd, ad, id, crc)
// don't false-positive against "items", "speed", "and", "build", "scratch".
export function rankProspective(cards: ProspectiveCard[], query: string | undefined | null): ProspectiveCard[] {
  const q = (query ?? "").toLowerCase();
  if (!q) return [];
  const out: { card: ProspectiveCard; score: number }[] = [];
  for (const card of cards) {
    const areas = PROOF[card.id] ?? [];
    let best: { area: ProofArea; score: number } | null = null;
    for (const a of areas) {
      const score = a.keywords.reduce((n, kw) => (matchKeyword(q, kw) ? n + 1 : n), 0);
      if (score > 0 && (!best || score > best.score)) best = { area: a, score };
    }
    if (!best) continue;
    out.push({
      card: { ...card, matched: { area: best.area.area, fact: best.area.fact } },
      score: best.score,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.map((s) => s.card);
}

function matchKeyword(query: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(query);
}
