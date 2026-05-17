"use client";

// V1 Enrichment — 4 supplier cards (spec § 4 Beat 3).
//
// Each card starts empty (no chips, no tier, no claimed metadata) and fills
// in as the live Browser Use session pushes ExtractedFields over SSE.
// This is the demo's whole credibility argument: the audience must see the
// agent DO the work, not see pre-populated data appear on mount.
//
// Lifecycle per card:
//   1. Pending scrape       — dim, "Pending scrape", no chips
//   2. Scraping… {N}        — amber pulse, action-log counter live
//   3. Filled (progressive) — chips fade in as fields land
//   4. Scrape complete · K  — final conviction tier chip animates in
//
// Conviction tier is derived client-side from the live ExtractedFields via
// `computeConvictionFromEvidence` — never pre-baked on the seed.

import { useEffect, useMemo, useState } from "react";
import type { EnrichSupplierState } from "@/lib/agents/enrich";
import {
  computeConvictionFromEvidence,
  type ConvictionTier,
} from "@/lib/demo-suppliers";
import type {
  BrowserSessionHandle,
  ExtractedFields,
} from "@/lib/integrations/browser-use";

interface Props {
  states: EnrichSupplierState[];
  /** Called when the user clicks a ▣ pip to view that supplier's live iframe. */
  onPipClick: (supplierId: string) => void;
  /**
   * Called when the user clicks the supplier name or card body — opens the
   * SupplierDetail view in the right pane. Separate from the checkbox so
   * multi-select state isn't perturbed.
   */
  onOpen?: (supplierId: string) => void;
  /** Called with the selected supplier_ids when "Launch sequence" fires. */
  onLaunch: (selectedSupplierIds: string[]) => void;
  /** Which supplier_id currently owns the iframe pane (for visual marker). */
  activeSupplierId?: string | null;
  /** Which supplier_id currently owns the SupplierDetail pane. */
  openedSupplierId?: string | null;
}

const TIER_LABEL: Record<ConvictionTier, string> = {
  high_match: "High match",
  worth_pursuing: "Worth pursuing",
  long_shot: "Long shot",
};

const TIER_PILL_CLASS: Record<ConvictionTier, string> = {
  high_match: "pill brand",
  worth_pursuing: "pill outline-brand",
  long_shot: "pill warn",
};

export function SupplierCardsGrid({
  states,
  onPipClick,
  onOpen,
  onLaunch,
  activeSupplierId,
  openedSupplierId,
}: Props) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([k]) => k),
    [selected],
  );

  const toggle = (id: string) =>
    setSelected((cur) => ({ ...cur, [id]: !cur[id] }));

  return (
    <div className="enrich-grid">
      <div className="enrich-grid-hd">
        <span className="mono">Suppliers ({states.length})</span>
      </div>

      <div className="enrich-cards">
        {states.map((state) => (
          <SupplierCard
            key={state.supplier.supplier_id}
            state={state}
            selected={!!selected[state.supplier.supplier_id]}
            onToggle={toggle}
            onPipClick={onPipClick}
            onOpen={onOpen}
            isActive={activeSupplierId === state.supplier.supplier_id}
            isOpened={openedSupplierId === state.supplier.supplier_id}
          />
        ))}
      </div>

      <div className="enrich-cta">
        <button
          type="button"
          className="enrich-launch"
          disabled={selectedIds.length === 0}
          onClick={() => onLaunch(selectedIds)}
        >
          Launch sequence on selected ({selectedIds.length})
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Individual card — owns its own SSE subscription so the live action-log
// counter, conviction tier, and chips populate in real time without
// re-rendering the whole grid.
// ───────────────────────────────────────────────────────────────────────────

interface CardProps {
  state: EnrichSupplierState;
  selected: boolean;
  onToggle: (id: string) => void;
  onPipClick: (supplierId: string) => void;
  onOpen?: (supplierId: string) => void;
  isActive: boolean;
  isOpened: boolean;
}

function SupplierCard({
  state,
  selected,
  onToggle,
  onPipClick,
  onOpen,
  isActive,
  isOpened,
}: CardProps) {
  const id = state.supplier.supplier_id;
  const isDirectory = state.supplier.enrichment_mode === "directory";

  // Live handle from SSE — null until first event arrives. We seed with
  // whatever the parent already has (typically the empty starting handle).
  const [handle, setHandle] = useState<BrowserSessionHandle | null>(
    (state.session as BrowserSessionHandle | null) ?? null,
  );

  useEffect(() => {
    if (isDirectory) return; // crovi.bio has no scrape session
    // Re-seed in case states[] just refreshed.
    setHandle((state.session as BrowserSessionHandle | null) ?? null);
    const es = new EventSource(`/api/enrich/sessions/${id}/stream`);
    const onMessage = (ev: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(ev.data) as BrowserSessionHandle;
        setHandle(payload);
      } catch {
        // ignore
      }
    };
    es.addEventListener("message", onMessage);
    return () => {
      es.removeEventListener("message", onMessage);
      es.close();
    };
    // We re-subscribe only when supplier id changes — `state.session` ref is
    // stable per supplier across re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isDirectory]);

  const extracted: ExtractedFields = handle?.extracted ?? {};
  const conviction = useMemo(() => {
    if (isDirectory) {
      return {
        tier: state.conviction,
        reason: state.conviction_reason,
        filled: 0,
      };
    }
    return computeConvictionFromEvidence(extracted);
  }, [extracted, isDirectory, state.conviction, state.conviction_reason]);

  const status = handle?.status;
  const isScraping =
    !isDirectory &&
    (status === "starting" || status === "live" || status === "running");
  const isComplete =
    !isDirectory && (status === "complete" || status === "partial");
  const isFailed =
    !isDirectory &&
    (status === "failed" || status === "timed_out" || status === "timeout");
  const eventCount = handle?.action_log.length ?? 0;

  // Inventory beat — only RefMed populates this, and only mid-scrape.
  const inventory = extracted.inventory_loaded;
  // Pre-XLSX-reveal placeholder copy: "Loading inventory…" — driven entirely
  // by whether the inventory_loaded field has landed yet.
  const showInventoryLoading = id === "refmed" && isScraping && !inventory;

  // Chips derived live from extracted fields.
  const conditionChips = extracted.claimed_conditions ?? [];
  const sampleTypeChips = extracted.sample_types ?? [];

  const handleOpen = () => onOpen?.(id);

  return (
    <div
      className={`enrich-card ${selected ? "sel" : ""} ${isActive ? "iframe-active" : ""} ${isOpened ? "detail-active" : ""} ${isScraping ? "is-scraping" : ""} ${!conviction.tier && !isDirectory ? "is-pending" : ""}`}
    >
      <label
        className="enrich-card-check"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${state.supplier.name}`}
        />
      </label>

      <div
        className="enrich-card-body"
        role={onOpen ? "button" : undefined}
        tabIndex={onOpen ? 0 : undefined}
        onClick={handleOpen}
        onKeyDown={(e) => {
          if (!onOpen) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleOpen();
          }
        }}
      >
        <div className="enrich-card-top">
          <span className="enrich-card-flag">{state.supplier.flag}</span>
          <span className="enrich-card-name">{state.supplier.name}</span>
          {handle && !isDirectory && (
            <button
              type="button"
              className={`enrich-pip ${isActive ? "on" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                onPipClick(id);
              }}
              title="View live Chromium session"
              aria-label={`View live Chromium session for ${state.supplier.name}`}
            >
              ▣
            </button>
          )}
        </div>

        {/* Conviction chip — lands only when evidence has scored a tier. */}
        <div className="enrich-card-row">
          {conviction.tier ? (
            <>
              <span
                key={conviction.tier /* re-mount → re-trigger animation */}
                className={`${TIER_PILL_CLASS[conviction.tier]} ip-anim-in`}
              >
                {TIER_LABEL[conviction.tier]}
              </span>
              {conviction.reason && (
                <span className="enrich-card-reason mono-sm">
                  {conviction.reason}
                </span>
              )}
            </>
          ) : (
            <span className="enrich-card-pending-chip mono-sm">
              {isScraping ? "Scoring…" : "Awaiting evidence"}
            </span>
          )}
        </div>

        {/* Status line — drives the audience's "is something happening?" */}
        <div className="enrich-card-status mono-sm">
          <StatusDot
            kind={
              isDirectory
                ? "directory"
                : isFailed
                ? "fail"
                : isComplete
                ? "done"
                : isScraping
                ? "live"
                : "pending"
            }
          />
          <span>
            {isDirectory
              ? "Direct contact + form"
              : isFailed
              ? `Scrape failed${handle?.error ? `: ${handle.error}` : ""}`
              : isComplete
              ? `Scrape complete · ${conviction.filled} field${conviction.filled === 1 ? "" : "s"}`
              : isScraping
              ? `Scraping… ${eventCount} event${eventCount === 1 ? "" : "s"}`
              : "Pending scrape"}
          </span>
        </div>

        <div className="enrich-card-blurb">{state.supplier.blurb}</div>

        {/* Evidence-driven chips: fade in as the scrape lands fields. */}
        {(conditionChips.length > 0 || sampleTypeChips.length > 0) && (
          <div className="enrich-card-chips">
            {conditionChips.slice(0, 6).map((c) => (
              <span key={`c:${c}`} className="enrich-chip ip-anim-in">
                {c}
              </span>
            ))}
            {sampleTypeChips.slice(0, 6).map((s) => (
              <span key={`s:${s}`} className="enrich-chip alt ip-anim-in">
                {s}
              </span>
            ))}
          </div>
        )}

        {/* RefMed inventory reveal beat: "Loading inventory…" until the
            scrape's XLSX download narrative fires, then the row count
            animates in. */}
        {id === "refmed" && (
          <div className="enrich-card-inventory">
            {inventory ? (
              <>
                <span className="tag brand ip-anim-in">
                  XLSX · {inventory.specimen_count.toLocaleString()} rows
                </span>
                <span className="enrich-card-inventory-top mono-sm ip-anim-in">
                  {inventory.top_indications.slice(0, 3).join(" · ")}
                </span>
              </>
            ) : showInventoryLoading ? (
              <span className="enrich-card-inventory-loading mono-sm">
                <span className="enrich-loading-dot" />
                Loading inventory…
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusDot({
  kind,
}: {
  kind: "pending" | "live" | "done" | "fail" | "directory";
}) {
  return <span className={`enrich-status-dot enrich-status-dot-${kind}`} />;
}

export default SupplierCardsGrid;
