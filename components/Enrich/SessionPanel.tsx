"use client";

// V1 Enrichment — live local-browser session panel (spec § 4 Beat 3 + § 6 V1.5).
//
// We launch a HEADLESS Chromium per supplier and pipe a ~4 fps JPEG
// screenshot stream into this panel as the source-of-truth audience view.
// The action log + extracted fields render below the live frame.
//
// Two SSE channels arrive on /api/enrich/sessions/[supplierId]/stream:
//   - default `message` events: full BrowserSessionHandle snapshots
//   - named  `frame`   events: { ts, b64 } JPEG frames

import { useEffect, useMemo, useState } from "react";
import type { EnrichSupplierState } from "@/lib/agents/enrich";
import type {
  ActionEvent,
  BrowserSessionHandle,
  ExtractedFields,
} from "@/lib/integrations/browser-use";

interface Props {
  /** The supplier whose session this panel mirrors. */
  supplierId: string | null;
  /** Snapshot from enrich() — used for the supplier name + initial session. */
  states: EnrichSupplierState[];
}

type Status = BrowserSessionHandle["status"];

const STATUS_PIP: Record<Status, { color: string; label: string }> = {
  starting: { color: "amber", label: "starting" },
  live: { color: "green", label: "live" },
  running: { color: "green", label: "running" },
  complete: { color: "green", label: "complete" },
  partial: { color: "amber", label: "partial" },
  failed: { color: "red", label: "failed" },
  timed_out: { color: "red", label: "timed out" },
  timeout: { color: "red", label: "timed out" },
};

const FIELD_ORDER: Array<{ key: keyof ExtractedFields; label: string }> = [
  { key: "contact_email", label: "Contact email" },
  { key: "contact_phone", label: "Contact phone" },
  { key: "contact_bd_name", label: "BD contact" },
  { key: "claimed_conditions", label: "Claimed conditions" },
  { key: "sample_types", label: "Sample types" },
  { key: "public_catalog_url", label: "Public catalog URL" },
  { key: "intake_form_url", label: "Intake form URL" },
  { key: "geography", label: "Geography" },
];

function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.length > 0 ? v.join(", ") : "—";
  return String(v);
}

function isUrl(v: unknown): boolean {
  return typeof v === "string" && /^https?:\/\//i.test(v);
}

/**
 * Source link for an extracted value:
 *   - If the value itself is a URL → link to that URL.
 *   - Else → link to the scrape's target page so the audience can verify.
 */
function sourceHref(value: unknown, target: string | undefined): string | null {
  if (isUrl(value)) return String(value);
  if (target && /^https?:\/\//i.test(target)) return target;
  return null;
}

/**
 * Render an extracted field value with provenance:
 *   - URL values → the value text itself is the clickable anchor
 *   - Non-URL values → the value renders as text, followed by a visible
 *     "source ↗" pill linking to the page the field was scraped from
 *   - No href → plain text
 *
 * Replaces the easy-to-miss ↗ arrow that the audience kept overlooking.
 */
function ValueWithSource({
  value,
  target,
}: {
  value: unknown;
  target: string | undefined;
}) {
  if (value == null || (Array.isArray(value) && value.length === 0)) {
    return <>—</>;
  }
  if (isUrl(value)) {
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

function shortTime(iso: string): string {
  return iso.slice(11, 19);
}

export function SessionPanel({ supplierId, states }: Props) {
  const supplier = useMemo(
    () => states.find((s) => s.supplier.supplier_id === supplierId),
    [states, supplierId],
  );
  const [handle, setHandle] = useState<BrowserSessionHandle | null>(
    (supplier?.session as BrowserSessionHandle | null) ?? null,
  );
  /** Latest JPEG frame received over SSE (base64, no data: prefix). */
  const [frameB64, setFrameB64] = useState<string | null>(null);

  // Subscribe to SSE updates for this supplier.
  useEffect(() => {
    if (!supplierId) {
      setHandle(null);
      setFrameB64(null);
      return;
    }
    // Pre-seed with whatever the parent already has.
    setHandle((supplier?.session as BrowserSessionHandle | null) ?? null);
    setFrameB64(null);

    const es = new EventSource(`/api/enrich/sessions/${supplierId}/stream`);
    const onMessage = (ev: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(ev.data) as BrowserSessionHandle;
        setHandle(payload);
      } catch {
        // ignore malformed event
      }
    };
    const onFrame = (ev: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(ev.data) as { ts: string; b64: string };
        if (payload.b64) setFrameB64(payload.b64);
      } catch {
        // ignore malformed event
      }
    };
    es.addEventListener("message", onMessage);
    es.addEventListener("frame", onFrame as EventListener);
    es.addEventListener("error", () => {
      // Browser will auto-retry; nothing to do.
    });
    return () => {
      es.removeEventListener("message", onMessage);
      es.removeEventListener("frame", onFrame as EventListener);
      es.close();
    };
    // We re-subscribe only when supplierId changes — `supplier?.session` is a
    // ref-stable snapshot for the same supplier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  if (!supplier) {
    return (
      <div className="session-panel">
        <div className="session-panel-hd">
          <span className="mono">No session selected</span>
        </div>
        <div className="session-panel-empty mono-sm">
          Click a ▣ pip on a supplier card to mirror its session.
        </div>
      </div>
    );
  }

  const status: Status = handle?.status ?? "starting";
  const pip = STATUS_PIP[status];
  const log: ActionEvent[] = handle?.action_log ?? [];
  const extracted: ExtractedFields = handle?.extracted ?? {};
  const isTerminal =
    status === "complete" ||
    status === "partial" ||
    status === "failed" ||
    status === "timed_out" ||
    status === "timeout";

  return (
    <div className="session-panel">
      <div className="session-panel-hd">
        <span className="session-panel-title">
          <span className={`session-pip session-pip-${pip.color}`} />
          Live browser session — {supplier.supplier.name}
        </span>
        <span className="session-panel-hd-right">
          {!isTerminal && <span className="session-live-pip mono-sm">LIVE</span>}
          <span className="mono-sm session-panel-status">{pip.label}</span>
        </span>
      </div>

      <div className="session-frame">
        {frameB64 ? (
          <img
            className="session-frame-img"
            src={`data:image/jpeg;base64,${frameB64}`}
            alt={`Headless Chromium viewport — ${supplier.supplier.name}`}
          />
        ) : (
          <div className="session-frame-empty mono-sm">
            ↻ booting headless Chromium…
          </div>
        )}
      </div>

      <div className="session-panel-body">
        <div className="session-actionlog">
          <div className="session-section-label mono-sm">Action log</div>
          {log.length === 0 ? (
            <div className="mono-sm session-actionlog-empty">Waiting…</div>
          ) : (
            <ul className="session-actionlog-list">
              {log.map((line, i) => (
                <li key={i} className={`session-actionlog-line kind-${line.kind}`}>
                  <span className="mono-sm session-actionlog-t">
                    {shortTime(line.t)}
                  </span>
                  <span className="session-actionlog-kind mono-sm">{line.kind}</span>
                  <span className="session-actionlog-text">{line.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="session-extracted">
          <div className="session-section-label mono-sm">Extracted so far</div>
          <dl className="session-extracted-dl">
            {FIELD_ORDER.map(({ key, label }) => {
              const v = extracted[key];
              const filled = v != null && (Array.isArray(v) ? v.length > 0 : String(v).length > 0);
              return (
                <div
                  key={key}
                  className={`session-extracted-row ${filled ? "filled" : "empty"}`}
                >
                  <dt className="mono-sm">{label}</dt>
                  <dd>
                    <ValueWithSource value={v} target={handle?.target_url} />
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </div>
    </div>
  );
}

export default SessionPanel;
