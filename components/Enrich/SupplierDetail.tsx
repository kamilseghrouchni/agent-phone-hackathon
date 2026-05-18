"use client";

// V1 Enrichment — supplier detail panel.
//
// Right-pane companion to SessionPanel. The user clicks a supplier card name
// → this view renders the supplier-specific data we already have:
//
//   - RefMed     → 14,637-row XLSX inventory: totals, top conditions (with
//                  bar chart), top sample types, debounced free-text filter,
//                  and a scrollable preview of matching rows.
//   - Geneticist / Audubon → evidence-pool projection of the 8 scrape fields
//                  laid out as a full card-style detail panel.
//   - Crovi.bio  → directory entry: contact + waitlist form + meta label.
//
// All data comes from `/api/suppliers/[supplierId]?runId=…` so we never ship
// the full row table to the client.

import { useEffect, useMemo, useRef, useState } from "react";
import { getV1Supplier, type DemoSupplierCardSeed } from "@/lib/demo-suppliers";

interface CountEntry {
  label: string;
  count: number;
}

interface InventoryRow {
  rm_id: string;
  condition: string;
  sample_type: string;
  stage?: string;
  fee_usd?: number;
}

interface IntakeMatchSummary {
  count: number;
  total: number;
  criteria: {
    indication?: string[];
    specimen_types?: string[];
    stages?: string[];
  };
}

interface RefMedInventoryPayload {
  total_specimens: number;
  total_cases: number;
  unique_conditions: number;
  unique_sample_types: number;
  top_conditions: CountEntry[];
  top_sample_types: CountEntry[];
  rows_total: number;
  rows_truncated_at: number;
  rows: InventoryRow[];
  intake_match?: IntakeMatchSummary;
}

interface SupplierDetailResponse {
  supplier_id: string;
  name: string;
  country: string;
  flag: string;
  blurb: string;
  conviction_tier?: "high_match" | "worth_pursuing" | "long_shot";
  claimed: DemoSupplierCardSeed["claimed"];
  extracted: Record<string, unknown>;
  inventory?: RefMedInventoryPayload;
}

interface Props {
  supplierId: string;
  runId: string;
}

const SCRAPE_FIELD_LABELS: Array<{ key: string; label: string }> = [
  { key: "contact.bd_email", label: "Contact email" },
  { key: "contact.bd_phone", label: "Contact phone" },
  { key: "contact.bd_name", label: "BD contact" },
  { key: "conditions.list", label: "Claimed conditions" },
  { key: "specimen.types", label: "Sample types" },
  { key: "specimen.format", label: "Specimen format" },
  { key: "catalog.public_xlsx_url", label: "Public catalog URL" },
  { key: "form.intake_url", label: "Intake form URL" },
  { key: "shipping.domestic", label: "Domestic shipping" },
  { key: "shipping.international", label: "Intl shipping" },
  { key: "regulatory.cap_clia", label: "CAP / CLIA" },
  { key: "regulatory.irb_status", label: "IRB status" },
  { key: "regulatory.consent_model", label: "Consent model" },
  { key: "about.tagline", label: "Tagline" },
];

function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.length > 0 ? v.join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function isFilled(v: unknown): boolean {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.length > 0;
  return true;
}

function isUrlValue(v: unknown): boolean {
  return typeof v === "string" && /^https?:\/\//i.test(v);
}

/**
 * Source link for an extracted field:
 *   - If the value is a URL → link to that URL directly.
 *   - Else → link to the supplier's scrape target page so the audience can
 *     verify the field on the page it was scraped from.
 */
function sourceHref(value: unknown, target: string | null | undefined): string | null {
  if (isUrlValue(value)) return String(value);
  if (target && /^https?:\/\//i.test(target)) return target;
  return null;
}

function SourceLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="source-link"
      aria-label="View source page"
      title={href}
    >
      {" "}↗
    </a>
  );
}

/**
 * Render an extracted value with provenance:
 *   - URL values → the value text itself is the clickable anchor
 *   - Non-URL values → text followed by a visible "source ↗" pill
 *   - No href → plain text
 *
 * Mirrors components/Enrich/SessionPanel.tsx so the two panes feel the same.
 */
function ValueWithSource({
  value,
  target,
}: {
  value: unknown;
  target: string | null | undefined;
}) {
  if (!isFilled(value)) return <>—</>;
  if (isUrlValue(value)) {
    const href = String(value);
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="extracted-link"
        title={href}
      >
        {href}
      </a>
    );
  }
  const href = target && /^https?:\/\//i.test(target) ? target : null;
  return (
    <>
      {formatValue(value)}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="source-pill"
          title={`Source: ${href}`}
        >
          source ↗
        </a>
      ) : null}
    </>
  );
}

export function SupplierDetail({ supplierId, runId }: Props) {
  const [data, setData] = useState<SupplierDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounced filter input (RefMed only).
  const [filterRaw, setFilterRaw] = useState("");
  const [filter, setFilter] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setFilter(filterRaw.trim()), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filterRaw]);

  // Track the supplier we last successfully loaded so the filter-debounce
  // effect (which fires on every keystroke against the SAME supplier) doesn't
  // wipe the data — only a real supplier change should clear stale info.
  const loadedSupplierIdRef = useRef<string | null>(null);

  useEffect(() => {
    let aborted = false;
    // eslint-disable-next-line no-console
    console.log("[SupplierDetail] effect fire", { supplierId, runId, filter });
    setLoading(true);
    setError(null);
    // When supplierId changes, drop the previous supplier's payload immediately.
    // Filter keystrokes against the same supplier skip this branch (the
    // `loadedSupplierIdRef` check) so we don't flicker the inventory table.
    if (loadedSupplierIdRef.current !== supplierId) {
      setData(null);
      // NOTE — we deliberately do NOT reset filterRaw/filter here. Doing so
      // schedules a setFilter("") via the debounce effect, which then re-fires
      // this same useEffect (filter is a dep), and during that brief window
      // any in-flight fetch is aborted. In React 18 strict mode dev, the
      // double-invoke amplifies the race and the "latest" fetch can end up
      // marked aborted before its handlers run — the user sees
      // "↻ fetching detail…" forever. Cheap fix: drop the auto-reset and
      // let the user clear the filter manually if they want.
    }
    const params = new URLSearchParams();
    if (runId) params.set("runId", runId);
    if (filter) params.set("q", filter);
    params.set("limit", "50");
    const url = `/api/suppliers/${supplierId}?${params.toString()}`;
    // eslint-disable-next-line no-console
    console.log("[SupplierDetail] fetch start", url);
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as SupplierDetailResponse;
      })
      .then((payload) => {
        // eslint-disable-next-line no-console
        console.log("[SupplierDetail] fetch ok", {
          supplierId,
          aborted,
          name: payload?.name,
        });
        if (aborted) return;
        loadedSupplierIdRef.current = supplierId;
        setData(payload);
        setLoading(false);
      })
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.warn("[SupplierDetail] fetch err", {
          supplierId,
          aborted,
          err: e,
        });
        if (aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      // eslint-disable-next-line no-console
      console.log("[SupplierDetail] effect cleanup → aborted", { supplierId });
      aborted = true;
    };
  }, [supplierId, runId, filter]);

  const maxConditionCount = useMemo(() => {
    if (!data?.inventory) return 0;
    return data.inventory.top_conditions.reduce(
      (acc, c) => Math.max(acc, c.count),
      0,
    );
  }, [data]);

  if (loading && !data) {
    return (
      <div className="supplier-detail">
        <div className="supplier-detail-hd">
          <span className="mono">Loading supplier…</span>
        </div>
        <div className="supplier-detail-empty mono-sm">↻ fetching detail…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="supplier-detail">
        <div className="supplier-detail-hd">
          <span className="mono">Supplier detail</span>
        </div>
        <div className="supplier-detail-empty mono-sm">
          {error ?? "no data"}
        </div>
      </div>
    );
  }

  return (
    <div className="supplier-detail">
      <div className="supplier-detail-hd">
        <span className="supplier-detail-title">
          <span className="supplier-detail-flag">{data.flag}</span>
          <span className="serif supplier-detail-name">{data.name}</span>
        </span>
        <span className="mono-sm supplier-detail-country">{data.country}</span>
      </div>

      <div className="supplier-detail-body">
        <div className="supplier-detail-blurb">{data.blurb}</div>

        {data.inventory ? (
          <RefMedInventoryView
            inv={data.inventory}
            maxConditionCount={maxConditionCount}
            filter={filterRaw}
            onFilterChange={setFilterRaw}
            loading={loading}
          />
        ) : data.supplier_id === "crovi_bio" ? (
          <CroviDirectoryView claimed={data.claimed} />
        ) : (
          <ScrapeExtractedView
            claimed={data.claimed}
            extracted={data.extracted}
            sourceUrl={getV1Supplier(data.supplier_id)?.scrape_target ?? null}
          />
        )}
      </div>
    </div>
  );
}

function RefMedInventoryView({
  inv,
  maxConditionCount,
  filter,
  onFilterChange,
  loading,
}: {
  inv: RefMedInventoryPayload;
  maxConditionCount: number;
  filter: string;
  onFilterChange: (v: string) => void;
  loading: boolean;
}) {
  return (
    <>
      {inv.intake_match ? (
        <div className="supplier-detail-intake-match">
          <span className="supplier-detail-roll-big">
            {inv.intake_match.count.toLocaleString()}
          </span>
          <span className="supplier-detail-roll-unit mono-sm">
            of {inv.intake_match.total.toLocaleString()} specimens match your
            query
          </span>
          <div className="supplier-detail-intake-criteria mono-sm">
            {inv.intake_match.criteria.indication?.length ? (
              <span className="supplier-detail-criteria-chip">
                indication: {inv.intake_match.criteria.indication.join(", ")}
              </span>
            ) : null}
            {inv.intake_match.criteria.specimen_types?.length ? (
              <span className="supplier-detail-criteria-chip">
                sample: {inv.intake_match.criteria.specimen_types.join(", ")}
              </span>
            ) : null}
            {inv.intake_match.criteria.stages?.length ? (
              <span className="supplier-detail-criteria-chip">
                stage: {inv.intake_match.criteria.stages.join("/")}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="supplier-detail-roll">
        <span className="supplier-detail-roll-big">
          {inv.total_specimens.toLocaleString()}
        </span>
        <span className="supplier-detail-roll-unit mono-sm">specimens</span>
        <span className="supplier-detail-roll-sep">·</span>
        <span className="mono-sm">
          {inv.unique_conditions} conditions
        </span>
        <span className="supplier-detail-roll-sep">·</span>
        <span className="mono-sm">
          {inv.unique_sample_types} sample types
        </span>
        <span className="supplier-detail-roll-sep">·</span>
        <span className="mono-sm">
          {inv.total_cases.toLocaleString()} cases
        </span>
      </div>

      <div className="supplier-detail-grid">
        <section className="supplier-detail-block">
          <div className="supplier-detail-block-hd mono-sm">
            Top conditions
          </div>
          <ul className="supplier-detail-bars">
            {inv.top_conditions.map((c) => {
              const pct =
                maxConditionCount > 0
                  ? (c.count / maxConditionCount) * 100
                  : 0;
              return (
                <li key={c.label} className="supplier-detail-bar-row">
                  <span className="supplier-detail-bar-label">{c.label}</span>
                  <span className="supplier-detail-bar-track">
                    <span
                      className="supplier-detail-bar-fill"
                      style={{ width: `${pct.toFixed(1)}%` }}
                    />
                  </span>
                  <span className="supplier-detail-bar-count mono-sm">
                    {c.count.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="supplier-detail-block">
          <div className="supplier-detail-block-hd mono-sm">
            Top sample types
          </div>
          <ul className="supplier-detail-bars">
            {inv.top_sample_types.map((c) => {
              const pct =
                maxConditionCount > 0
                  ? (c.count / Math.max(1, inv.top_sample_types[0]?.count ?? 1)) * 100
                  : 0;
              return (
                <li key={c.label} className="supplier-detail-bar-row">
                  <span className="supplier-detail-bar-label">{c.label}</span>
                  <span className="supplier-detail-bar-track">
                    <span
                      className="supplier-detail-bar-fill alt"
                      style={{ width: `${pct.toFixed(1)}%` }}
                    />
                  </span>
                  <span className="supplier-detail-bar-count mono-sm">
                    {c.count.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="supplier-detail-block">
        <div className="supplier-detail-block-hd-row">
          <span className="supplier-detail-block-hd mono-sm">
            Row preview
            <span className="supplier-detail-count mono-sm">
              {" "}
              · {inv.rows_total.toLocaleString()} matching
              {inv.rows_total > inv.rows.length &&
                ` · showing first ${inv.rows.length}`}
            </span>
          </span>
          <input
            type="text"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder="filter — condition, sample type, stage…"
            className="supplier-detail-filter"
            aria-label="Filter inventory rows"
          />
        </div>
        <div className="supplier-detail-table-wrap">
          <table className="supplier-detail-table">
            <thead>
              <tr>
                <th>RM ID</th>
                <th>Condition</th>
                <th>Sample type</th>
                <th>Stage</th>
                <th className="num">Fee (USD)</th>
              </tr>
            </thead>
            <tbody>
              {inv.rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="supplier-detail-table-empty">
                    {loading ? "↻ filtering…" : "no matching rows"}
                  </td>
                </tr>
              ) : (
                inv.rows.map((r) => (
                  <tr key={r.rm_id}>
                    <td className="mono-sm">{r.rm_id}</td>
                    <td>{r.condition}</td>
                    <td>{r.sample_type}</td>
                    <td>{r.stage ?? "—"}</td>
                    <td className="num mono-sm">
                      {r.fee_usd != null ? r.fee_usd.toLocaleString() : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function ScrapeExtractedView({
  claimed,
  extracted,
  sourceUrl,
}: {
  claimed: DemoSupplierCardSeed["claimed"];
  extracted: Record<string, unknown>;
  sourceUrl: string | null;
}) {
  const hasAnyExtracted = Object.values(extracted).some(isFilled);
  const filledLabels = SCRAPE_FIELD_LABELS.filter((f) =>
    isFilled(extracted[f.key]),
  );
  const emptyLabels = SCRAPE_FIELD_LABELS.filter(
    (f) => !isFilled(extracted[f.key]),
  );

  return (
    <>
      <section className="supplier-detail-block">
        <div className="supplier-detail-block-hd mono-sm">Claimed (directory)</div>
        <dl className="supplier-detail-dl">
          <div className="supplier-detail-dl-row">
            <dt className="mono-sm">Conditions</dt>
            <dd>{claimed.conditions.join(", ") || "—"}</dd>
          </div>
          <div className="supplier-detail-dl-row">
            <dt className="mono-sm">Sample types</dt>
            <dd>{claimed.sample_types.join(", ") || "—"}</dd>
          </div>
          {claimed.contact?.email && (
            <div className="supplier-detail-dl-row">
              <dt className="mono-sm">Email</dt>
              <dd>
                <a href={`mailto:${claimed.contact.email}`}>
                  {claimed.contact.email}
                </a>
              </dd>
            </div>
          )}
          {claimed.contact?.phone && (
            <div className="supplier-detail-dl-row">
              <dt className="mono-sm">Phone</dt>
              <dd className="mono-sm">{claimed.contact.phone}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="supplier-detail-block">
        <div className="supplier-detail-block-hd mono-sm">
          Scrape-extracted{" "}
          <span className="supplier-detail-count mono-sm">
            · {filledLabels.length} / {SCRAPE_FIELD_LABELS.length} fields
          </span>
        </div>
        {!hasAnyExtracted ? (
          <div className="supplier-detail-empty-inline mono-sm">
            No scrape evidence in the pool yet — see the Live session tab.
          </div>
        ) : (
          <dl className="supplier-detail-dl">
            {filledLabels.map(({ key, label }) => {
              const v = extracted[key];
              return (
                <div
                  key={key}
                  className="supplier-detail-dl-row supplier-detail-dl-row-filled"
                >
                  <dt className="mono-sm">{label}</dt>
                  <dd>
                    <ValueWithSource value={v} target={sourceUrl} />
                  </dd>
                </div>
              );
            })}
            {emptyLabels.length > 0 && (
              <div className="supplier-detail-dl-row supplier-detail-dl-row-empty">
                <dt className="mono-sm">Not yet captured</dt>
                <dd className="mono-sm">
                  {emptyLabels.map((f) => f.label).join(" · ")}
                </dd>
              </div>
            )}
          </dl>
        )}
      </section>
    </>
  );
}

function CroviDirectoryView({
  claimed,
}: {
  claimed: DemoSupplierCardSeed["claimed"];
}) {
  return (
    <section className="supplier-detail-block">
      <div className="supplier-detail-block-hd mono-sm">
        Discovery-layer meta candidate
      </div>
      <dl className="supplier-detail-dl">
        <div className="supplier-detail-dl-row">
          <dt className="mono-sm">Scope</dt>
          <dd>{claimed.conditions.join(", ") || "all"}</dd>
        </div>
        <div className="supplier-detail-dl-row">
          <dt className="mono-sm">Sample types</dt>
          <dd>{claimed.sample_types.join(", ") || "all"}</dd>
        </div>
        {claimed.contact?.email && (
          <div className="supplier-detail-dl-row supplier-detail-dl-row-filled">
            <dt className="mono-sm">Email</dt>
            <dd>
              <a href={`mailto:${claimed.contact.email}`}>
                {claimed.contact.email}
              </a>
            </dd>
          </div>
        )}
        {claimed.contact?.form_url && (
          <div className="supplier-detail-dl-row supplier-detail-dl-row-filled">
            <dt className="mono-sm">Waitlist form</dt>
            <dd>
              <a
                href={claimed.contact.form_url}
                target="_blank"
                rel="noreferrer"
              >
                {claimed.contact.form_url}
              </a>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

export default SupplierDetail;
