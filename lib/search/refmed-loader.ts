// RefMed XLSX loader.
//
// Parses the bundled inventory file into typed Case + Specimen records.
// Loaded lazily on first call; cached in module scope. The file ships with
// banner/instruction rows at the top of each sheet, so we anchor on the
// known header row indices (Cases: 7, All specimens: 9).
//
// In Vercel-deployed mode you should pre-convert to JSON at build time —
// see refmed-loader.test.ts notes. For local dev we load XLSX directly.

import path from "path";
import * as XLSX from "xlsx";

export interface RefMedCase {
  rm_case_id: string;
  donor_id: string;
  diagnosis_type: string; // "Benign tumor", "Cancer, ..."
  primary_tumor_site: string;
  specimen_sites: string;
  tumor_type: string;
  t?: string;
  n?: string;
  m?: string;
  stage?: string;
  treatment_status?: string;
  blood_mL?: number;
  plasma_mL?: number;
  serum_mL?: number;
  buffy_coat_mL?: number;
  collection_tube?: string;
  frozen_tissue_count?: number;
  tumor_malignant_blocks?: number;
  tumor_nonmalignant_blocks?: number;
  tumor_borderline_blocks?: number;
  abnormal_blocks?: number;
  normal_blocks?: number;
  collection_setting?: string;
  age?: number;
  gender?: string;
  race?: string;
  pre_surgical_diagnosis?: string;
  pathologic_diagnosis?: string;
  genomic_variants?: string;
}

export interface RefMedSpecimen {
  rm_id: string;          // unique specimen ID (e.g. "RM22-00014-D15")
  rm_case_id: string;     // links back to RefMedCase
  specimen_type: string;  // "Paraffin block", "Plasma", "Serum", ...
  tier?: number;
  fee_usd?: number;
  specimen_site?: string;
  tissue_type?: string;   // "Tumor, malignant", "Normal", ...
  primary_tumor_site?: string;
  tumor_type?: string;
  t?: string;
  n?: string;
  m?: string;
  stage?: string;
  tissue_area_mm2?: number;
  tumor_area_mm2?: number;
  tumor_pct?: number;
  necrosis_pct?: number;
  tissue_thickness_mm?: number;
  blood_mL?: number;
  plasma_mL?: number;
  serum_mL?: number;
  buffy_coat_mL?: number;
  collection_tube?: string;
  collection_setting?: string;
  age?: number;
  gender?: string;
  race?: string;
  pathologic_diagnosis?: string;
  treatment_status?: string;
  genomic_variants?: string;
}

// Column index → field name maps. Row 7 of Cases / row 9 of All specimens
// were inspected by hand; if RefMed reorders columns the loader breaks
// loudly (good — better than silent mis-mapping).

const CASE_HEADER_ROW = 7;
const CASE_DATA_START = 8;
const SPECIMEN_HEADER_ROW = 9;
const SPECIMEN_DATA_START = 10;

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s.length === 0 ? undefined : s;
}

function rowToCase(r: unknown[]): RefMedCase | null {
  const rm_case_id = str(r[1]);
  if (!rm_case_id) return null;
  return {
    rm_case_id,
    donor_id: str(r[2]) ?? "",
    diagnosis_type: str(r[3]) ?? "",
    primary_tumor_site: str(r[4]) ?? "",
    specimen_sites: str(r[5]) ?? "",
    tumor_type: str(r[6]) ?? "",
    t: str(r[7]),
    n: str(r[8]),
    m: str(r[9]),
    stage: str(r[10]),
    treatment_status: str(r[11]),
    blood_mL: num(r[12]),
    plasma_mL: num(r[13]),
    serum_mL: num(r[14]),
    buffy_coat_mL: num(r[15]),
    collection_tube: str(r[16]),
    frozen_tissue_count: num(r[17]),
    tumor_malignant_blocks: num(r[18]),
    tumor_nonmalignant_blocks: num(r[19]),
    tumor_borderline_blocks: num(r[20]),
    abnormal_blocks: num(r[21]),
    normal_blocks: num(r[22]),
    collection_setting: str(r[24]),
    age: num(r[25]),
    gender: str(r[26]),
    race: str(r[27]),
    pre_surgical_diagnosis: str(r[28]),
    pathologic_diagnosis: str(r[29]),
    genomic_variants: str(r[31]),
  };
}

function rowToSpecimen(r: unknown[]): RefMedSpecimen | null {
  const rm_case_id = str(r[3]);
  const rm_id = str(r[9]) ?? `${rm_case_id ?? "unknown"}-row`;
  if (!rm_case_id) return null;
  return {
    rm_id,
    rm_case_id,
    specimen_type: str(r[6]) ?? "",
    tier: num(r[7]),
    fee_usd: num(r[8]),
    specimen_site: str(r[10]),
    tissue_type: str(r[11]),
    primary_tumor_site: str(r[12]),
    tumor_type: str(r[13]),
    t: str(r[14]),
    n: str(r[15]),
    m: str(r[16]),
    stage: str(r[17]),
    tissue_area_mm2: num(r[18]),
    tumor_area_mm2: num(r[19]),
    tumor_pct: num(r[20]),
    necrosis_pct: num(r[21]),
    tissue_thickness_mm: num(r[22]),
    blood_mL: num(r[23]),
    plasma_mL: num(r[24]),
    serum_mL: num(r[25]),
    buffy_coat_mL: num(r[26]),
    collection_tube: str(r[27]),
    collection_setting: str(r[29]),
    age: num(r[30]),
    gender: str(r[31]),
    race: str(r[32]),
    pathologic_diagnosis: str(r[34]),
    treatment_status: str(r[35]),
    genomic_variants: str(r[37]),
  };
}

let cachedCases: RefMedCase[] | null = null;
let cachedSpecimens: RefMedSpecimen[] | null = null;
let cachedSpecimensByCase: Map<string, RefMedSpecimen[]> | null = null;

function defaultXlsxPath(): string {
  return (
    process.env.REFMED_XLSX_PATH ??
    path.join(process.cwd(), "store/inventory/refmed_2026-05.xlsx")
  );
}

export function loadRefMed(xlsxPath: string = defaultXlsxPath()): {
  cases: RefMedCase[];
  specimens: RefMedSpecimen[];
  specimensByCase: Map<string, RefMedSpecimen[]>;
} {
  if (cachedCases && cachedSpecimens && cachedSpecimensByCase) {
    return { cases: cachedCases, specimens: cachedSpecimens, specimensByCase: cachedSpecimensByCase };
  }

  const wb = XLSX.readFile(xlsxPath);
  const casesSheet = wb.Sheets["Cases"];
  const specSheet = wb.Sheets["All specimens"];
  if (!casesSheet || !specSheet) {
    throw new Error(`RefMed XLSX missing expected sheets. Saw: ${wb.SheetNames.join(", ")}`);
  }

  const caseRows = XLSX.utils.sheet_to_json<unknown[]>(casesSheet, { header: 1, defval: null });
  const specRows = XLSX.utils.sheet_to_json<unknown[]>(specSheet, { header: 1, defval: null });

  // Header sanity — fail loudly if RefMed reordered columns.
  const caseHeader = caseRows[CASE_HEADER_ROW] as unknown[];
  if (str(caseHeader[1]) !== "RM case ID") {
    throw new Error(`RefMed Cases header drift: col 1 was "${caseHeader[1]}", expected "RM case ID"`);
  }
  const specHeader = specRows[SPECIMEN_HEADER_ROW] as unknown[];
  if (str(specHeader[3]) !== "RM case ID") {
    throw new Error(`RefMed Specimens header drift: col 3 was "${specHeader[3]}", expected "RM case ID"`);
  }

  const cases: RefMedCase[] = [];
  for (let i = CASE_DATA_START; i < caseRows.length; i++) {
    const c = rowToCase(caseRows[i]);
    if (c) cases.push(c);
  }
  const specimens: RefMedSpecimen[] = [];
  for (let i = SPECIMEN_DATA_START; i < specRows.length; i++) {
    const s = rowToSpecimen(specRows[i]);
    if (s) specimens.push(s);
  }

  const byCase = new Map<string, RefMedSpecimen[]>();
  for (const s of specimens) {
    const arr = byCase.get(s.rm_case_id) ?? [];
    arr.push(s);
    byCase.set(s.rm_case_id, arr);
  }

  cachedCases = cases;
  cachedSpecimens = specimens;
  cachedSpecimensByCase = byCase;
  return { cases, specimens, specimensByCase: byCase };
}
