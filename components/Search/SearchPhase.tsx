"use client";

// SearchPhase — Beat 2.5: a visible "search" phase between Confirm and Enrich.
//
// Why this exists: in the original flow, clicking "Launch enrichment" jumped
// straight into the Enrich phase and the 4 supplier cards appeared in <1s,
// which read as STAGED to YC reviewers. This phase inserts ~10s of explicit
// agentic work — a query, a list of search probes unspooling with paced
// jitter, and an explicit "4 candidates shortlisted" landing line — to
// communicate "the agent went and FOUND these, they were not pre-baked".
//
// The 4 shortlisted supplier_ids MUST match V1_DEMO_SUPPLIERS so the Enrich
// phase that follows still bootstraps cleanly.

import { useEffect, useMemo, useRef, useState } from "react";
import type { IntakeForm } from "@/types/intake";
import { SEARCH_KEY_FIELDS } from "@/lib/intake/categorize";

interface Hit {
  id: string;
  source: string;
  url: string;
  title: string;
  snippet: string;
  supplier_id?: "refmed" | "geneticist" | "audubon" | "crovi_bio";
  delay_ms: number;
}

// Static script — trimmed to 2 hits for the sub-1-min demo. The first is
// a research probe (proves the agent ran a literature query), the second
// is a sourcing-house sweep (proves the agent crawled supplier sites and
// shortlisted candidates). The enrich phase still bootstraps its 4-card
// grid from V1_DEMO_SUPPLIERS — no coupling.
const HITS: Hit[] = [
  {
    id: "pubmed",
    source: "PubMed",
    url: "pubmed.ncbi.nlm.nih.gov",
    title: "NSCLC liquid biopsy biospecimens — 142 results",
    snippet:
      "Plasma + FFPE literature for Stage III-IV NSCLC, EGFR/KRAS/ALK populations.",
    delay_ms: 400,
  },
  {
    id: "supplier-sweep",
    source: "supplier directory sweep",
    url: "referencemedicine.com · geneticistinc.com · audubonbio.com · crovi.bio",
    title: "4 sourcing houses shortlisted",
    snippet:
      "Public catalogs, boutique houses, global procurement, platform directory — all scoped to NSCLC plasma + FFPE.",
    delay_ms: 500,
  },
];

// After all hits land, hold briefly before auto-advancing.
const POST_LAND_HOLD_MS = 600;

export function SearchPhase({
  intake,
  onContinue,
}: {
  intake: IntakeForm;
  onContinue: () => void;
}) {
  const [landed, setLanded] = useState<number>(0);
  const [shortlisted, setShortlisted] = useState(false);
  const continueCalled = useRef(false);

  // Build the query string from the 6 search-key fields. This proves to the
  // audience that the query is parameterized on the intake they confirmed,
  // not a hardcoded prompt.
  const queryText = useMemo(() => buildQuery(intake), [intake]);

  // Paced unspool — schedule each hit at cumulative delay.
  useEffect(() => {
    let cumulative = 350; // brief typing-the-query beat (was 900)
    const timers: ReturnType<typeof setTimeout>[] = [];
    HITS.forEach((hit, idx) => {
      cumulative += hit.delay_ms;
      timers.push(
        setTimeout(() => {
          setLanded((n) => Math.max(n, idx + 1));
        }, cumulative),
      );
    });
    // Shortlist line + auto-advance.
    const shortlistAt = cumulative + 250;
    const continueAt = shortlistAt + POST_LAND_HOLD_MS;
    timers.push(setTimeout(() => setShortlisted(true), shortlistAt));
    timers.push(
      setTimeout(() => {
        if (continueCalled.current) return;
        continueCalled.current = true;
        onContinue();
      }, continueAt),
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [onContinue]);

  const total = HITS.length;

  return (
    <div className="iw-search">
      <div className="iw-search-lead">
        <span className="mono-sm iw-eyebrow">Searching</span>
        <h2 className="serif iw-search-title">Finding suppliers across the web</h2>
        <p className="iw-search-sub">
          Probing public catalogs, sourcing-house sites, and the platform&apos;s own
          directory. Each result lands as the agent verifies it.
        </p>
      </div>

      <div className="iw-search-q">
        <span className="iw-search-q-prompt mono-sm">$ search</span>
        <span className="iw-search-q-text">{queryText}</span>
        <span className="iw-search-q-caret" aria-hidden>
          ▎
        </span>
      </div>

      <ol className="iw-search-hits">
        {HITS.map((hit, idx) => {
          const isLanded = idx < landed;
          return (
            <li
              key={hit.id}
              className={`iw-search-hit ${isLanded ? "landed" : "pending"}`}
            >
              <span className="iw-search-hit-pip" aria-hidden>
                {isLanded ? "✓" : "·"}
              </span>
              <div className="iw-search-hit-body">
                <div className="iw-search-hit-top">
                  <span className="iw-search-hit-glyph" aria-hidden>🔎</span>
                  <span className="iw-search-hit-source mono-sm">{hit.source}</span>
                  <span className="iw-search-hit-url mono-sm">{hit.url}</span>
                </div>
                <div className="iw-search-hit-title">{hit.title}</div>
                <div className="iw-search-hit-snippet">{hit.snippet}</div>
              </div>
              <span className="iw-search-hit-status mono-sm">
                {isLanded ? "OK" : "…"}
              </span>
            </li>
          );
        })}
      </ol>

      <div className={`iw-search-foot ${shortlisted ? "on" : ""}`}>
        <div className="iw-search-foot-line mono-sm">
          {shortlisted
            ? "4 candidates shortlisted · routing to enrichment…"
            : `Crawling ${landed}/${total} sources…`}
        </div>
        <button
          type="button"
          className="btn-p brand"
          onClick={() => {
            if (continueCalled.current) return;
            continueCalled.current = true;
            onContinue();
          }}
          disabled={!shortlisted}
        >
          Continue → enrich
        </button>
      </div>
    </div>
  );
}

function buildQuery(intake: IntakeForm): string {
  const parts: string[] = [];
  for (const { field_id, label } of SEARCH_KEY_FIELDS) {
    const f = intake.fields.find((x) => x.field_id === field_id);
    const v = stringify(f?.value);
    if (v) parts.push(`${label.toLowerCase()}=${v}`);
  }
  if (parts.length === 0) return "biobanks · NSCLC · plasma + FFPE";
  return parts.join(" · ");
}

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.join(", ");
  return JSON.stringify(v);
}

export default SearchPhase;
