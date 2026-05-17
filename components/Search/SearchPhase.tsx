"use client";

// SearchPhase — chat-thread rendering of the agent's web-search beat.
//
// Read of the room: the original "list of hits unspooling" version landed
// flat — reviewers saw rows appear without believing an agent did anything.
// This version reframes the same beat as a prompt-kit-style assistant turn:
// the agent shows reasoning (shimmering as it thinks), fires tool calls
// (web_search / fetch), and each call streams its result chip-by-chip. The
// supplier_ids that get shortlisted at the end still match V1_DEMO_SUPPLIERS
// so the Enrich phase bootstraps cleanly.

import { useEffect, useMemo, useRef, useState } from "react";
import type { IntakeForm } from "@/types/intake";
import { SEARCH_KEY_FIELDS } from "@/lib/intake/categorize";

type ToolKind = "web_search" | "fetch";

interface ToolStep {
  id: string;
  kind: ToolKind;
  /** Short label the agent "calls" the tool with — shown in the chip arg slot. */
  arg: string;
  /** Hostname / source label rendered below the chip. */
  source: string;
  /** Bulleted observations the agent extracts from the tool result. */
  observations: string[];
  /** Whether this result corresponds to a supplier that gets shortlisted. */
  supplier_id?: "refmed" | "geneticist" | "audubon" | "crovi_bio";
  /** ms after the previous step completes before this one starts. */
  delay_ms: number;
  /** ms the call "runs" before observations land. */
  run_ms: number;
}

const REASONING_LINES = [
  "Parsing the 6 search keys from the confirmed intake…",
  "NSCLC · plasma + FFPE · Stage III–IV · EGFR/KRAS/ALK — I need vendors that publish a real catalog, not just a contact form.",
  "Strategy: hit the literature for cohort signal, then sweep the known commercial + boutique houses, then check our own directory.",
];

// Each step's supplier_id (when present) must match V1_DEMO_SUPPLIERS so the
// Enrich phase finds the cards we "shortlisted" here.
const STEPS: ToolStep[] = [
  {
    id: "pubmed",
    kind: "web_search",
    arg: "NSCLC plasma FFPE biospecimen cohort",
    source: "pubmed.ncbi.nlm.nih.gov",
    observations: [
      "142 results for NSCLC liquid biopsy biospecimens",
      "Plasma + FFPE cohorts for Stage III–IV, EGFR/KRAS/ALK populations",
    ],
    delay_ms: 320,
    run_ms: 740,
  },
  {
    id: "linkedin",
    kind: "web_search",
    arg: "biobank procurement Boston oncology BD",
    source: "linkedin.com",
    observations: [
      "8 sourcing houses with active oncology BD",
      "Cross-referenced against known vendor footprints",
    ],
    delay_ms: 220,
    run_ms: 820,
  },
  {
    id: "refmed",
    kind: "fetch",
    arg: "referencemedicine.com/catalog",
    source: "referencemedicine.com",
    observations: [
      "U.S. commercial supplier · public monthly catalog",
      "Monthly XLSX export + embedded Airtable",
    ],
    supplier_id: "refmed",
    delay_ms: 240,
    run_ms: 880,
  },
  {
    id: "geneticist",
    kind: "fetch",
    arg: "geneticistinc.com",
    source: "geneticistinc.com",
    observations: [
      "Boutique sourcing house · prose catalog",
      "NSCLC + CRC core competencies",
    ],
    supplier_id: "geneticist",
    delay_ms: 200,
    run_ms: 720,
  },
  {
    id: "audubon",
    kind: "fetch",
    arg: "audubonbio.com",
    source: "audubonbio.com",
    observations: [
      "Global biospecimen procurement · Houston HQ",
      "Multi-form intake · NSCLC + broader oncology",
    ],
    supplier_id: "audubon",
    delay_ms: 200,
    run_ms: 760,
  },
  {
    id: "crovi",
    kind: "fetch",
    arg: "crovi.bio",
    source: "crovi.bio",
    observations: [
      "Direct contact + waitlist form",
      "Surfaced because it IS the discovery layer",
    ],
    supplier_id: "crovi_bio",
    delay_ms: 160,
    run_ms: 580,
  },
];

// After the last step's observations land, hold this long before auto-advancing.
const POST_LAND_HOLD_MS = 1600;
// Per-line stagger when each reasoning line reveals.
const REASONING_REVEAL_MS = 560;

type StepState = "pending" | "running" | "done";

export function SearchPhase({
  intake,
  onContinue,
}: {
  intake: IntakeForm;
  onContinue: () => void;
}) {
  const [reasoningLanded, setReasoningLanded] = useState(0);
  const [reasoningDone, setReasoningDone] = useState(false);
  const [stepStates, setStepStates] = useState<StepState[]>(
    () => STEPS.map(() => "pending"),
  );
  const [shortlisted, setShortlisted] = useState(false);
  const continueCalled = useRef(false);

  const queryText = useMemo(() => buildQuery(intake), [intake]);

  // Single scheduler — reasoning lines first, then step run/done events.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let t = 600; // initial "agent woke up" beat

    // Reasoning lines reveal one by one.
    REASONING_LINES.forEach((_, i) => {
      t += REASONING_REVEAL_MS;
      timers.push(
        setTimeout(() => setReasoningLanded((n) => Math.max(n, i + 1)), t),
      );
    });
    t += 420;
    timers.push(setTimeout(() => setReasoningDone(true), t));

    // Tool calls — each step transitions pending → running → done.
    STEPS.forEach((step, idx) => {
      t += step.delay_ms;
      const startAt = t;
      const doneAt = t + step.run_ms;
      timers.push(
        setTimeout(() => {
          setStepStates((prev) => {
            const next = prev.slice();
            next[idx] = "running";
            return next;
          });
        }, startAt),
      );
      timers.push(
        setTimeout(() => {
          setStepStates((prev) => {
            const next = prev.slice();
            next[idx] = "done";
            return next;
          });
        }, doneAt),
      );
      t = doneAt;
    });

    // Shortlist line + auto-advance.
    const shortlistAt = t + 500;
    const continueAt = shortlistAt + POST_LAND_HOLD_MS;
    timers.push(setTimeout(() => setShortlisted(true), shortlistAt));
    timers.push(
      setTimeout(() => {
        if (continueCalled.current) return;
        continueCalled.current = true;
        onContinue();
      }, continueAt),
    );
    return () => timers.forEach(clearTimeout);
  }, [onContinue]);

  const shortlistCount = STEPS.filter((s) => s.supplier_id).length;
  const runningCount = stepStates.filter((s) => s !== "pending").length;
  const doneCount = stepStates.filter((s) => s === "done").length;

  return (
    <div className="iw-chat">
      {/* User turn — the parameterized query */}
      <article className="iw-chat-msg iw-chat-msg-user">
        <header className="iw-chat-msg-hd">
          <span className="iw-chat-avatar iw-chat-avatar-user" aria-hidden>
            you
          </span>
          <span className="iw-chat-sender">Intake</span>
          <span className="iw-chat-meta mono-sm">
            {SEARCH_KEY_FIELDS.length} keys · parameterized
          </span>
        </header>
        <div className="iw-chat-msg-body">
          <p className="iw-chat-userline">
            Find suppliers across the web that can fulfill this request.
          </p>
          <div className="iw-chat-query mono-sm">
            <span className="iw-chat-query-tag">QUERY</span>
            <span className="iw-chat-query-text">{queryText}</span>
          </div>
        </div>
      </article>

      {/* Assistant turn — reasoning + tool calls */}
      <article className="iw-chat-msg iw-chat-msg-assistant">
        <header className="iw-chat-msg-hd">
          <span className="iw-chat-avatar iw-chat-avatar-bot" aria-hidden>
            ✦
          </span>
          <span className="iw-chat-sender serif">Crovi</span>
          <span className="iw-chat-meta mono-sm">
            {shortlisted
              ? `${runningCount}/${STEPS.length} sources · ${doneCount} verified`
              : `${runningCount}/${STEPS.length} sources · running`}
          </span>
        </header>

        <div className="iw-chat-msg-body">
          {/* Reasoning block — shimmers while active, settles once done */}
          <details
            className={`iw-reasoning ${reasoningDone ? "done" : "live"}`}
            open
          >
            <summary className="iw-reasoning-sum">
              <span className="iw-reasoning-glyph" aria-hidden>
                {reasoningDone ? "✓" : "◐"}
              </span>
              <span className={reasoningDone ? "" : "iw-shimmer"}>
                {reasoningDone ? "Reasoned for 2.4s" : "Thinking…"}
              </span>
            </summary>
            <ol className="iw-reasoning-list">
              {REASONING_LINES.map((line, i) => (
                <li
                  key={i}
                  className={`iw-reasoning-line ${
                    i < reasoningLanded ? "on" : "off"
                  }`}
                >
                  {line}
                </li>
              ))}
            </ol>
          </details>

          {/* Tool calls — each is a chip + streaming observations */}
          <ol className="iw-tools">
            {STEPS.map((step, idx) => {
              const s = stepStates[idx];
              if (s === "pending") return null;
              return (
                <li key={step.id} className={`iw-tool iw-tool-${s}`}>
                  <div className="iw-tool-chip">
                    <span className="iw-tool-icon" aria-hidden>
                      {step.kind === "web_search" ? "🔍" : "🌐"}
                    </span>
                    <span className="iw-tool-name mono-sm">{step.kind}</span>
                    <span className="iw-tool-arg mono-sm">({step.arg})</span>
                    <span
                      className={`iw-tool-status mono-sm iw-tool-status-${s}`}
                    >
                      {s === "running" ? "running…" : "ok"}
                    </span>
                  </div>
                  <div className="iw-tool-source mono-sm">
                    ↳ <span className="iw-tool-source-host">{step.source}</span>
                  </div>
                  {s === "done" && (
                    <ul className="iw-tool-obs">
                      {step.observations.map((o, i) => (
                        <li key={i} className="iw-tool-obs-line">
                          {o}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>

          {/* Shortlist + continue */}
          <div className={`iw-chat-foot ${shortlisted ? "on" : ""}`}>
            <div className="iw-chat-foot-line">
              {shortlisted ? (
                <>
                  <span className="iw-chat-check" aria-hidden>
                    ✓
                  </span>
                  Shortlisted <strong>{shortlistCount}</strong> candidates ·
                  routing to enrichment…
                </>
              ) : (
                <span className="iw-shimmer">
                  Crawling {runningCount}/{STEPS.length} sources…
                </span>
              )}
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
      </article>
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
