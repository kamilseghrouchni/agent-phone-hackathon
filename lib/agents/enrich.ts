// V1 Enrichment orchestrator — spec § 4 Beat 3 + § 6 V1.2 / V1.3.
//
// Fires 3 concurrent Browser Use sessions (RefMed catalog, Geneticist About
// page, Audubon forms portal) and loads the RefMed XLSX from local disk in
// parallel. Each scrape targets the supplier's 8 extraction fields and
// writes results into the SupplierEvidence pool via appendEvidence().
//
// Crovi.bio appears as a 4th card from the internal directory only — no
// scrape session is fired for it (spec § 4 Beat 3: "Crovi.bio appears
// immediately from internal directory (no scrape)").

import path from "path";
import {
  startSession,
  type BrowserSessionHandle,
} from "@/lib/integrations/browser-use";
import { loadRefMed } from "@/lib/search/refmed-loader";
import { appendEvidence } from "@/lib/store/evidence-pool";
import {
  V1_DEMO_SUPPLIERS,
  type ConvictionTier,
  type DemoSupplierCardSeed,
} from "@/lib/demo-suppliers";
import type { SupplierEvidence } from "@/types/evidence";

// Per-supplier 8-field extraction targets — spec § 4 Beat 3.
//   "Each scrape extracts 6-8 fields per supplier into SupplierEvidence pool."
// The field_ids match the intake schema so the evidence pool projection
// downstream can flip status badges on the Filled Intake view.
export const EXTRACTION_TARGETS: Record<
  "refmed" | "geneticist" | "audubon" | "crovi_bio",
  string[]
> = {
  crovi_bio: [
    "about.tagline",
    "conditions.list",
    "specimen.types",
    "contact.bd_email",
    "form.intake_url",
    "calendar.url",
    "platform.feature_list",
    "regulatory.notes",
  ],
  refmed: [
    "conditions.list",
    "specimen.types",
    "specimen.format",
    "biomarker.subsets",
    "inventory.case_count",
    "inventory.refresh_date",
    "contact.bd_email",
    "catalog.public_xlsx_url",
  ],
  geneticist: [
    "conditions.list",
    "specimen.types",
    "specimen.format",
    "regulatory.cap_clia",
    "contact.bd_name",
    "contact.bd_email",
    "contact.bd_phone",
    "about.tagline",
  ],
  audubon: [
    "conditions.list",
    "specimen.types",
    "shipping.domestic",
    "shipping.international",
    "regulatory.irb_status",
    "regulatory.consent_model",
    "form.intake_url",
    "form.field_count",
  ],
};

export interface EnrichSupplierState {
  supplier: DemoSupplierCardSeed;
  /**
   * Evidence-derived conviction tier. NULL on initial state — populated only
   * after the scrape has pulled enough fields to score. The card UI watches
   * the SSE handle and re-derives this live via
   * `computeConvictionFromEvidence`. Server-side this stays null and the
   * client renders nothing until evidence lands.
   */
  conviction: ConvictionTier | null;
  conviction_reason: string;
  /** Null for crovi.bio (no scrape session). */
  session: BrowserSessionHandle | null;
  /** Set after the RefMed XLSX has been parsed. */
  inventory_summary?: {
    case_count: number;
    specimen_count: number;
    top_indications: string[];
  };
}

// Re-export the conviction helper from demo-suppliers for callers that
// already import it from this module. The implementation lives there
// because the supplier-card client component bundles it and demo-suppliers
// is the lowest-deps module the client can pull from.
export { computeConvictionFromEvidence } from "@/lib/demo-suppliers";

export interface EnrichResult {
  run_id: string;
  started_at: string;
  states: EnrichSupplierState[];
  buyer_conditions: string[];
}

export interface EnrichOptions {
  /** Buyer's claimed conditions — drives conviction scoring. */
  buyer_conditions?: string[];
}

function fieldsToTaskList(fields: string[]): string {
  return fields.map((f) => `  - ${f}`).join("\n");
}

function evidenceFromScrapeMeta(
  supplier_id: string,
  field_id: string,
  value: unknown,
  session_id: string,
): SupplierEvidence {
  return {
    supplier_id,
    field_id,
    value,
    channel: "browse",
    evidence_id: `scrape:${session_id}:${field_id}`,
    confidence: "medium",
    timestamp: new Date().toISOString(),
  };
}

/**
 * Side-effect: load the RefMed XLSX and write per-row evidence into the pool.
 * Returns the inventory summary for the RefMed card body.
 *
 * Spec § 6 V1.3: "load from local file via existing lib/search/refmed-loader.ts
 * and populate evidence pool". 14,637 row writes are sequential but cheap
 * (in-memory append) — measured ~80ms on the demo box.
 */
function loadRefMedInventory(runId: string): EnrichSupplierState["inventory_summary"] {
  const xlsxPath =
    process.env.REFMED_XLSX_PATH ??
    path.join(
      process.cwd(),
      "docs",
      "yc-hackathon ", // trailing space in folder name — intentional, matches filesystem
      "Reference Medicine_May Inverntory File.xlsx",
    );

  const { cases, specimens } = loadRefMed(xlsxPath);

  // Per-row evidence (specimen-level) — one record per row. The agent-facing
  // pool now answers "what does RefMed have for X?" with row-level provenance.
  for (const s of specimens) {
    appendEvidence(runId, {
      supplier_id: "refmed",
      field_id: `inventory.row.${s.rm_id}`,
      value: {
        specimen_type: s.specimen_type,
        primary_tumor_site: s.primary_tumor_site,
        tumor_type: s.tumor_type,
        stage: s.stage,
        treatment_status: s.treatment_status,
        plasma_mL: s.plasma_mL,
        fee_usd: s.fee_usd,
      },
      channel: "inventory_file",
      evidence_id: `refmed:row:${s.rm_id}`,
      confidence: "high",
      timestamp: new Date().toISOString(),
    });
  }

  // Top indications by case count.
  const counts = new Map<string, number>();
  for (const c of cases) {
    const k = c.primary_tumor_site || c.tumor_type || "unknown";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const top_indications = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, n]) => `${k} (${n})`);

  // Roll-up evidence for the card summary.
  appendEvidence(runId, {
    supplier_id: "refmed",
    field_id: "inventory.summary",
    value: {
      case_count: cases.length,
      specimen_count: specimens.length,
      top_indications,
    },
    channel: "inventory_file",
    evidence_id: `refmed:summary:${runId}`,
    confidence: "high",
    timestamp: new Date().toISOString(),
  });

  return {
    case_count: cases.length,
    specimen_count: specimens.length,
    top_indications,
  };
}

function buildTask(supplier: DemoSupplierCardSeed): string {
  const targets =
    EXTRACTION_TARGETS[
      supplier.supplier_id as keyof typeof EXTRACTION_TARGETS
    ] ?? [
      "conditions.list",
      "specimen.types",
      "contact.bd_email",
      "about.tagline",
    ];
  return `Scrape ${supplier.scrape_target} for the following fields, return as JSON:
${fieldsToTaskList(targets)}

Stay on the supplier's domain. If a field is not present, omit it (don't guess).`;
}

/**
 * Public entry: fire enrichment for a run. Returns AS SOON AS the 3 Browser
 * Use sessions have been *created* — Playwright launch + scrape continue in
 * the background and report via the SSE bus. The slow RefMed XLSX load runs
 * inline because it's a synchronous file read (cached after first call).
 *
 * Caller (route) should `await enrich(...)` only for the initial state
 * envelope; it returns in <100ms typically because startSession() spawns its
 * Playwright work on a microtask.
 */
export async function enrich(
  runId: string,
  opts: EnrichOptions = {},
): Promise<EnrichResult> {
  const t0 = Date.now();
  const buyer_conditions = opts.buyer_conditions ?? ["NSCLC"];
  const started_at = new Date().toISOString();
  const scrapeSeeds = V1_DEMO_SUPPLIERS.filter(
    (s) => s.enrichment_mode !== "directory" && !!s.scrape_target,
  );

  // eslint-disable-next-line no-console
  console.log(
    `[enrich] start runId=${runId} suppliers=[${scrapeSeeds.map((s) => s.supplier_id).join(",")}]`,
  );

  // Kick the 3 real scrape sessions concurrently. startSession() returns its
  // handle synchronously and spawns Playwright work on a microtask, so this
  // resolves fast (<50ms).
  const sessionResults = await Promise.allSettled(
    scrapeSeeds.map((seed) =>
      startSession({
        supplier_id: seed.supplier_id,
        target_url: seed.scrape_target!,
        task: buildTask(seed),
      }),
    ),
  );
  const sessionsBySupplier = new Map<string, BrowserSessionHandle | null>();
  scrapeSeeds.forEach((seed, i) => {
    const r = sessionResults[i];
    sessionsBySupplier.set(
      seed.supplier_id,
      r.status === "fulfilled" ? r.value : null,
    );
  });

  // Stamp scrape-meta evidence for each running session so the pool has
  // an anchor row per (supplier, field) even before the agent returns
  // verbatim values.
  for (const seed of scrapeSeeds) {
    const session = sessionsBySupplier.get(seed.supplier_id) ?? null;
    if (!session) continue;
    const fields =
      EXTRACTION_TARGETS[
        seed.supplier_id as "refmed" | "geneticist" | "audubon"
      ] ?? [];
    for (const field_id of fields) {
      appendEvidence(
        runId,
        evidenceFromScrapeMeta(seed.supplier_id, field_id, null, session.session_id),
      );
    }
  }

  // RefMed XLSX load — runs IN BACKGROUND, deferred via setImmediate so the
  // 14,637 sync evidence writes don't block the HTTP response. (An async
  // IIFE wouldn't yield: there are no awaits inside, so the body would run
  // inline.)
  setImmediate(() => {
    try {
      const t1 = Date.now();
      const summary = loadRefMedInventory(runId);
      // eslint-disable-next-line no-console
      console.log(
        `[enrich] refmed XLSX loaded runId=${runId} +${Date.now() - t1}ms cases=${summary?.case_count} specs=${summary?.specimen_count}`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[enrich] RefMed XLSX load failed:", err);
    }
  });

  // Build the per-supplier state envelopes the UI consumes. Conviction
  // starts NULL — the card renders an empty-state until the live scrape
  // (SSE) pushes enough ExtractedFields for computeConvictionFromEvidence
  // to land on a tier. crovi.bio (directory mode, no scrape) is the one
  // exception: we settle it on worth_pursuing immediately since there's
  // nothing to wait for.
  const states: EnrichSupplierState[] = V1_DEMO_SUPPLIERS.map((seed) => {
    const session = sessionsBySupplier.get(seed.supplier_id) ?? null;
    const isDirectory = seed.enrichment_mode === "directory";
    return {
      supplier: seed,
      conviction: isDirectory ? "worth_pursuing" : null,
      conviction_reason: isDirectory ? "discovery-layer meta candidate" : "",
      session,
      inventory_summary: undefined,
    };
  });

  // Touch `buyer_conditions` so the lint rule doesn't fire — kept on the
  // result envelope for downstream agents that may want to score against it
  // (e.g., the future agent-endpoint skill consumes it).
  void buyer_conditions;

  // eslint-disable-next-line no-console
  console.log(
    `[enrich] returning runId=${runId} +${Date.now() - t0}ms sessions=${sessionsBySupplier.size}`,
  );

  return {
    run_id: runId,
    started_at,
    states,
    buyer_conditions,
  };
}
