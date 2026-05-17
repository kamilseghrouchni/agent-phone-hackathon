"use client";
import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import type { ParseResult } from "@/app/api/parse/types";

type Phase = "parse" | "search" | "rank" | "deliver";

const PHASES: { id: Phase; label: string; sub: string }[] = [
  { id: "parse", label: "PARSE", sub: "Read the request" },
  { id: "search", label: "SEARCH", sub: "Scan the catalog" },
  { id: "rank", label: "RANK", sub: "Score by fit" },
  { id: "deliver", label: "DELIVER", sub: "Build the dossier" },
];

type Beat = {
  phase: Phase;
  text: string;
  detail?: string;
  state: "pending" | "active" | "done";
  // Synthetic beats use a relative ms offset; real tool beats use a real timestamp
  at: number;
};

export function RunningView({
  parsed,
  messages,
  startedAt,
  done,
}: {
  parsed: ParseResult;
  messages: UIMessage[];
  startedAt: number;
  done: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (done) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [done]);

  // Derive real progress
  const progress = deriveProgress(messages, parsed);

  // Synthetic narrative beats — feel like the system is working in stages
  const elapsedMs = (done ? progress.lastEventAt - startedAt : now - startedAt);
  const beats = buildBeats(parsed, progress, elapsedMs, done);

  const currentPhase: Phase = beats.find((b) => b.state === "active")?.phase ?? (done ? "deliver" : "parse");

  return (
    <div className="running">
      <div className="running-top">
        <div className="run-statusline">
          <span className="mono live-line">
            {!done && <span className="live-dot" />}
            {done ? "RUN COMPLETE" : "RUN IN PROGRESS"}
          </span>
          <span className="thread-id">{fmtElapsed(elapsedMs)} ELAPSED</span>
        </div>
        <PhaseStepper current={currentPhase} done={done} />
      </div>

      <div className="running-body">
        <div className="running-beats">
          <div className="rb-eyebrow mono">What we're doing</div>
          <ul className="rb-list">
            {beats.map((b, i) => (
              <li key={i} className={`rb-beat ${b.state}`}>
                <span className="rb-time mono-sm">
                  {fmtElapsed(b.at)}
                </span>
                <span className={`rb-marker ${b.state}`}>
                  {b.state === "active" ? <span className="live-dot" /> : b.state === "done" ? "●" : "○"}
                </span>
                <div className="rb-body">
                  <div className="rb-text">{b.text}</div>
                  {b.detail && <div className="rb-detail mono-sm">→ {b.detail}</div>}
                </div>
              </li>
            ))}
          </ul>
          {!done && (
            <div className="rb-trail">
              <span className="live-dot" />
              <span>Working through the catalog · expect 5–10s on a warm cache.</span>
            </div>
          )}
        </div>

        <aside className="running-aside">
          <div className="ra-eyebrow mono">Request</div>
          <div className="ra-prose serif">{parsed.parsed_text}</div>
          <div className="ra-tags">
            {parsed.fields.slice(0, 6).map((f) => (
              <span key={f.key} className={`tag src-${f.source}`}>
                {f.label.toLowerCase()}: {f.value}
              </span>
            ))}
          </div>
          <div className="ra-stats">
            <Stat label="Catalog" value={`${parsed.facets.total_specimens.toLocaleString()} samples`} />
            <Stat label="Donors" value={parsed.facets.total_donors.toLocaleString()} />
            <Stat label="Institutes" value={String(parsed.facets.total_institutes)} />
            {parsed.facets.estimated_match != null && (
              <Stat
                label="Coarse match"
                value={`≈ ${parsed.facets.estimated_match.toLocaleString()}`}
                hint="pre-FTS estimate"
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="ra-stat">
      <div className="ra-stat-k mono-sm">{label}</div>
      <div className="ra-stat-v">{value}</div>
      {hint && <div className="ra-stat-h mono-sm">{hint}</div>}
    </div>
  );
}

function PhaseStepper({ current, done }: { current: Phase; done: boolean }) {
  const idx = PHASES.findIndex((p) => p.id === current);
  return (
    <div className="rphase-stepper">
      {PHASES.map((p, i) => {
        const state = done || i < idx ? "done" : i === idx ? "active" : "pending";
        return (
          <div key={p.id} className={`rphase ${state}`}>
            <div className="rphase-bar" />
            <div className="rphase-meta">
              <span className="rphase-name mono-sm">{p.label}</span>
              <span className="rphase-sub">{p.sub}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function fmtElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `00:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

type Progress = {
  toolStarted: boolean;
  toolStartedAt: number;
  toolCompleted: boolean;
  toolCompletedAt: number;
  resultPreview: { specimens: number; institutes: number } | null;
  lastEventAt: number;
};

function deriveProgress(messages: UIMessage[], _parsed: ParseResult): Progress {
  // Walk messages once and pull the first query_specimens tool's start/end
  // Note: we treat tool input arrival as "start", output as "end".
  let toolStarted = false;
  let toolStartedAt = 0;
  let toolCompleted = false;
  let toolCompletedAt = 0;
  let resultPreview: Progress["resultPreview"] = null;
  let lastEventAt = Date.now();
  for (const m of messages) {
    if (m.role !== "assistant" || !m.parts) continue;
    for (const p of m.parts as any[]) {
      if (p.type === "tool-query_specimens") {
        if (!toolStarted) {
          toolStarted = true;
          toolStartedAt = Date.now();
        }
        if (p.output) {
          toolCompleted = true;
          toolCompletedAt = Date.now();
          const r = p.output;
          if (r?.totals) {
            resultPreview = {
              specimens: r.totals.specimens ?? 0,
              institutes: r.totals.institutes ?? 0,
            };
          }
        }
      }
    }
  }
  return { toolStarted, toolStartedAt, toolCompleted, toolCompletedAt, resultPreview, lastEventAt };
}

function buildBeats(
  parsed: ParseResult,
  progress: Progress,
  elapsedMs: number,
  done: boolean
): Beat[] {
  const beats: Beat[] = [];
  const { fields, facets } = parsed;

  // Phase: parse — happens immediately
  const inferredCount = fields.filter((f) => f.source === "inferred").length;
  beats.push({
    phase: "parse",
    text: "Read the request, locked filters",
    detail:
      fields.length > 0
        ? `${fields.length} field${fields.length === 1 ? "" : "s"} captured · ${inferredCount} inferred`
        : "Free-text only — broad scan ahead",
    state: elapsedMs > 800 ? "done" : "active",
    at: 200,
  });

  // Phase: search
  const searchStartAt = 1200;
  const searchActive = elapsedMs >= searchStartAt && !progress.toolCompleted;
  const searchDone = progress.toolCompleted || done;
  beats.push({
    phase: "search",
    text:
      facets.estimated_match != null
        ? `Scanning catalog · narrowed to ≈ ${facets.estimated_match.toLocaleString()} candidate samples`
        : `Scanning all ${facets.total_specimens.toLocaleString()} catalog samples`,
    detail: `${facets.total_institutes} institutes · ${facets.top_specimen_types
      .slice(0, 3)
      .map((s) => s.name)
      .join(", ")}`,
    state: elapsedMs < searchStartAt ? "pending" : searchDone ? "done" : "active",
    at: searchStartAt,
  });

  if (elapsedMs >= 2400) {
    beats.push({
      phase: "search",
      text: `Cross-checking specimen-type and preservation against the catalog`,
      detail:
        facets.top_specimen_types
          .slice(0, 4)
          .map((t) => `${t.name} ${(t.count / facets.total_specimens * 100).toFixed(0)}%`)
          .join(" · "),
      state: searchDone ? "done" : "active",
      at: 2400,
    });
  }

  if (elapsedMs >= 3800) {
    beats.push({
      phase: "search",
      text: `Walking institute donor sets, computing per-institute counts`,
      state: searchDone ? "done" : "active",
      at: 3800,
    });
  }

  // Phase: rank
  if (progress.toolCompleted || elapsedMs >= 5400) {
    const rankStart = progress.toolCompletedAt ? progress.toolCompletedAt - progress.toolStartedAt + 1200 : 5400;
    const inst = progress.resultPreview?.institutes ?? null;
    beats.push({
      phase: "rank",
      text: inst != null ? `Ranking ${inst} institutes by fit, not by raw N` : `Ranking institutes by fit, not by raw N`,
      detail: "match-score = log(specimen count) + type overlap − contact penalty",
      state: done ? "done" : "active",
      at: Math.max(rankStart, 5400),
    });
  }

  // Phase: deliver
  if (done) {
    const spec = progress.resultPreview?.specimens ?? null;
    beats.push({
      phase: "deliver",
      text: spec != null ? `Assembled ${spec.toLocaleString()} matching specimens` : "Assembled the result",
      detail: "Top institute auto-selected · ranked list ready in left rail",
      state: "done",
      at: elapsedMs,
    });
  }

  return beats;
}
