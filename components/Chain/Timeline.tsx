"use client";
import { useEffect, useState } from "react";
import {
  CHAIN_STAGE_ORDER,
  CHAIN_STAGE_LABELS,
  type ChainStage,
  type ChainStageEvent,
  type ChainState,
} from "@/types/chain";

/**
 * Timeline — Beat 5 vertical stack of stage cards.
 *
 * Each stage card renders its bi-directional thread of ChainStageEvent[] with
 * timestamps + actor + channel icons + stable anchor IDs (event_id) so the
 * Filled Intake's provenance pills can scrollIntoView and highlight.
 *
 * When `runId` is provided, Stage 1 (form) and Stage 5 (meeting) cards
 * subscribe to the chain SSE's `stage_frame` channel and render a live
 * JPEG image stream from the headless Chromium driving that stage. Other
 * stages don't have an embedded view.
 *
 * Pattern reused from components/ChatRail/EventLog.tsx (event row) and
 * components/Running/RunningView.tsx (vertical beat list).
 */
export function Timeline({ chain, runId }: { chain: ChainState; runId?: string }) {
  // Per-stage latest JPEG frame (base64, no data: prefix). Only `form` and
  // `meeting` keys are populated.
  const [frames, setFrames] = useState<Partial<Record<ChainStage, string>>>({});

  useEffect(() => {
    if (!runId) return;
    const es = new EventSource(`/api/chain/${runId}/stream`);
    const onStageFrame = (ev: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(ev.data) as {
          stage: ChainStage;
          ts: string;
          b64: string;
        };
        if (!payload.b64) return;
        setFrames((prev) => ({ ...prev, [payload.stage]: payload.b64 }));
      } catch {
        // ignore malformed event
      }
    };
    es.addEventListener("stage_frame", onStageFrame as EventListener);
    return () => {
      es.removeEventListener("stage_frame", onStageFrame as EventListener);
      es.close();
    };
  }, [runId]);

  return (
    <div className="chain-tl">
      {CHAIN_STAGE_ORDER.map((stage, i) => (
        <StageCard
          key={stage}
          stage={stage}
          index={i + 1}
          chain={chain}
          frameB64={frames[stage]}
        />
      ))}
    </div>
  );
}

function StageCard({
  stage,
  index,
  chain,
  frameB64,
}: {
  stage: ChainStage;
  index: number;
  chain: ChainState;
  frameB64?: string;
}) {
  const cur = chain.stages[stage];
  const label = CHAIN_STAGE_LABELS[stage];
  const status = cur?.status ?? "locked";
  const events = cur?.events ?? [];
  const hasFrameSlot = stage === "form" || stage === "meeting";
  const showFrameSlot =
    hasFrameSlot && status !== "locked" && status !== "complete";
  return (
    <section className={`cl-stage status-${status}`} data-stage={stage}>
      <header className="cl-stage-hd">
        <div className="cl-stage-id">
          <span className="cl-stage-num mono-sm">[{index}]</span>
          <span className="cl-stage-name mono">{label.short}</span>
        </div>
        <span className={`cl-stage-status status-${status}`}>{statusLabel(status)}</span>
      </header>
      {(showFrameSlot || (hasFrameSlot && frameB64)) && (
        <div className="cl-stage-frame">
          {frameB64 ? (
            <img
              className="cl-stage-frame-img"
              src={`data:image/jpeg;base64,${frameB64}`}
              alt={`Live ${label.short} viewport`}
            />
          ) : (
            <div className="cl-stage-frame-empty mono-sm">↻ launching…</div>
          )}
        </div>
      )}
      {events.length === 0 ? (
        <div className="cl-empty">
          {status === "locked" ? "Locked · waits on prior stage" : "No events yet"}
        </div>
      ) : (
        <ul className="cl-thread">
          {events.map((e) => (
            <EventRow key={e.event_id} event={e} />
          ))}
        </ul>
      )}
    </section>
  );
}

function EventRow({ event }: { event: ChainStageEvent }) {
  const dir = event.direction;
  const icon = channelIcon(event.channel) ?? actorIcon(event.actor);
  return (
    <li
      id={event.event_id}
      data-event-id={event.event_id}
      className={`cl-evt dir-${dir} actor-${event.actor}`}
    >
      <span className="cl-evt-ts mono-sm">{formatTime(event.timestamp)}</span>
      <span className="cl-evt-arrow" aria-hidden>{arrowFor(dir)}</span>
      <span className="cl-evt-actor mono-sm">{event.actor}</span>
      {icon && <span className="cl-evt-ch" aria-hidden>{icon}</span>}
      <div className="cl-evt-body">
        {event.text && <div className="cl-evt-text">{event.text}</div>}
        {event.payload != null && (
          <pre className="cl-evt-payload mono-sm">{stringifyPayload(event.payload)}</pre>
        )}
      </div>
    </li>
  );
}

function arrowFor(dir: ChainStageEvent["direction"]): string {
  switch (dir) {
    case "outbound":
      return "→";
    case "inbound":
      return "←";
    case "reasoning":
      return "··";
    case "system":
    default:
      return "·";
  }
}

function channelIcon(ch?: ChainStageEvent["channel"]): string | null {
  if (!ch) return null;
  switch (ch) {
    case "browse":
      return "🌐";
    case "email":
      return "✉";
    case "sms":
      return "💬";
    case "call":
      return "📞";
    case "form":
      return "📝";
    case "calendar":
      return "📅";
    case "inventory_file":
      return "📊";
    case "pay":
      return "💳";
    default:
      return null;
  }
}

function actorIcon(actor: ChainStageEvent["actor"]): string | null {
  if (actor === "sponge" || actor === "stripe") return "💳";
  if (actor === "cal") return "📅";
  if (actor === "browser_use") return "🌐";
  return null;
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toISOString().substring(11, 19);
  } catch {
    return ts.slice(0, 8);
  }
}

function stringifyPayload(p: unknown): string {
  try {
    return JSON.stringify(p, null, 2);
  } catch {
    return String(p);
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case "locked":
      return "locked";
    case "ready":
      return "ready";
    case "in_progress":
      return "running";
    case "complete":
      return "✓ complete";
    case "failed":
      return "✗ failed";
    case "fallback":
      return "↻ fallback";
    default:
      return s;
  }
}
