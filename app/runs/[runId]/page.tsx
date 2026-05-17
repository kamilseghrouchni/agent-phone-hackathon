"use client";

// /runs/[runId] — stage-isolated test cockpit.
//
// 5 stage rows. Each row has:
//   - Status pill (locked / ready / in_progress / complete / failed)
//   - Event count
//   - Latest event text (truncated)
//   - "Fire this stage" button → POST /api/chain/fire-stage
//
// Live state subscribes to /api/chain/[runId]/stream and updates on every
// chain event. Use this page to test each integration in isolation —
// prior stages are auto-synthesized as complete, so you can validate
// email or SMS or meeting without running the whole serial chain.

import { use, useEffect, useState } from "react";

interface StageState {
  status: string;
  events: Array<{ event_id: string; direction?: string; text?: string }>;
}
interface ChainState {
  run_id: string;
  supplier_id: string;
  stages: Record<string, StageState>;
}

const STAGES = ["form", "call", "email", "sms_pay", "meeting"] as const;
type Stage = typeof STAGES[number];

const STAGE_LABEL: Record<Stage, string> = {
  form: "1. FORM",
  call: "2. CALL",
  email: "3. EMAIL",
  sms_pay: "4. SMS + PAY",
  meeting: "5. MEETING",
};

const STAGE_HINT: Record<Stage, string> = {
  form: "Playwright fills /forms/crovi-intake — paced typing of 25 fields",
  call: "AgentPhone dials your phone with Crovi-AI operator",
  email: "AgentMail sends Filled Intake + Quote to crovi@agentmail.to",
  sms_pay: "SMS-stub + Sponge-stub fire 'Funds wired — $10 settled'",
  meeting: "Playwright drives Notion calendar booking",
};

export default function Page({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const [chain, setChain] = useState<ChainState | null>(null);
  const [log, setLog] = useState<string[]>([]);

  // Subscribe to SSE for live updates
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/chain/${runId}/stream`);
      es.addEventListener("message", (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data?.chain) setChain(data.chain);
          else if (data?.stages) setChain(data);
        } catch {}
      });
    } catch {}
    // Also do an initial fetch via direct read of stream's first frame
    fetch(`/api/chain/${runId}/stream`).catch(() => {});
    return () => es?.close();
  }, [runId]);

  // Poll chain.json directly as fallback
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/runs/${runId}/state`);
        if (cancelled) return;
        const d = await r.json();
        if (d?.chain) setChain(d.chain);
      } catch {}
    };
    tick();
    const interval = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [runId]);

  const fireStage = async (stage: Stage) => {
    const t = new Date().toISOString().slice(11, 19);
    setLog((l) => [`[${t}] firing ${stage}…`, ...l].slice(0, 30));
    const r = await fetch("/api/chain/fire-stage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, stage }),
    });
    const j = await r.json().catch(() => ({}));
    const t2 = new Date().toISOString().slice(11, 19);
    setLog((l) => [`[${t2}] ${stage} → ${r.status} · ${JSON.stringify(j).slice(0, 120)}`, ...l].slice(0, 30));
  };

  const fireFormStart = async () => {
    const t = new Date().toISOString().slice(11, 19);
    setLog((l) => [`[${t}] firing /api/chain/start (full chain)…`, ...l].slice(0, 30));
    const r = await fetch("/api/chain/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, supplierId: "crovi_bio" }),
    });
    const j = await r.json().catch(() => ({}));
    const t2 = new Date().toISOString().slice(11, 19);
    setLog((l) => [`[${t2}] start → ${r.status} · ${JSON.stringify(j).slice(0, 120)}`, ...l].slice(0, 30));
  };

  return (
    <div style={S.page}>
      <header style={S.header}>
        <span style={S.dot} />
        <h1 style={S.title}>Crovi · stage cockpit</h1>
        <span style={S.runId}>{runId}</span>
      </header>

      <div style={S.help}>
        Fires individual stages against the real wire. Prior stages auto-synth as
        complete. Tests each integration in isolation — no need to run the full
        cascade end-to-end every time.
      </div>

      <div style={S.grid}>
        {STAGES.map((s) => {
          const st = chain?.stages?.[s] ?? { status: "locked", events: [] };
          const last = st.events?.length > 0 ? st.events[st.events.length - 1] : null;
          return (
            <div key={s} style={S.row}>
              <div style={S.rowL}>
                <div style={S.stageName}>{STAGE_LABEL[s]}</div>
                <div style={S.stageHint}>{STAGE_HINT[s]}</div>
              </div>
              <div style={S.rowM}>
                <span style={{ ...S.pill, ...statusStyle(st.status) }}>{st.status}</span>
                <span style={S.evCount}>{st.events?.length ?? 0} ev</span>
                <span style={S.evText}>{last?.text ? truncate(last.text, 80) : ""}</span>
              </div>
              <div style={S.rowR}>
                <button
                  type="button"
                  style={S.btn}
                  onClick={() => (s === "form" ? fireFormStart() : fireStage(s))}
                  title={s === "form" ? "Full chain from top" : `Synthesize prior stages, fire ${s} in isolation`}
                >
                  Fire {s === "form" ? "(start chain)" : s}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <h3 style={S.logH}>Log</h3>
      <pre style={S.log}>{log.join("\n") || "(no actions yet)"}</pre>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function statusStyle(status: string): React.CSSProperties {
  const map: Record<string, string> = {
    locked: "#6b7280",
    ready: "#9ca3af",
    in_progress: "#3b82f6",
    complete: "#10b981",
    failed: "#ef4444",
    fallback: "#f59e0b",
  };
  const bg = map[status] ?? "#6b7280";
  return { background: bg + "33", color: bg, border: `1px solid ${bg}66` };
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#0a0e14", color: "#e6edf3", padding: "32px 48px", fontFamily: "-apple-system, 'Inter', sans-serif", boxSizing: "border-box" },
  header: { display: "flex", alignItems: "center", gap: "12px", paddingBottom: "16px", borderBottom: "1px solid #1f2933" },
  dot: { width: "12px", height: "12px", borderRadius: "50%", background: "linear-gradient(135deg, #6ee7b7, #3b82f6)" },
  title: { margin: 0, fontSize: "20px", fontWeight: 600 },
  runId: { fontFamily: "ui-monospace, monospace", fontSize: "12px", color: "#8b96a3", marginLeft: "auto" },
  help: { fontSize: "13px", color: "#8b96a3", padding: "16px 0", lineHeight: 1.5 },
  grid: { display: "flex", flexDirection: "column", gap: "10px" },
  row: { display: "grid", gridTemplateColumns: "320px 1fr 180px", gap: "16px", alignItems: "center", padding: "14px 16px", background: "#0d1117", border: "1px solid #1f2933", borderRadius: "8px" },
  rowL: {},
  stageName: { fontSize: "14px", fontWeight: 600 },
  stageHint: { fontSize: "11px", color: "#8b96a3", marginTop: "4px", lineHeight: 1.4 },
  rowM: { display: "flex", alignItems: "center", gap: "12px", minWidth: 0 },
  pill: { padding: "3px 9px", borderRadius: "4px", fontSize: "11px", fontFamily: "ui-monospace, monospace", textTransform: "uppercase", letterSpacing: "0.05em" },
  evCount: { fontSize: "11px", color: "#8b96a3", fontFamily: "ui-monospace, monospace" },
  evText: { fontSize: "12px", color: "#c0c8d2", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },
  rowR: { textAlign: "right" as const },
  btn: { background: "linear-gradient(135deg, #3b82f6, #1d4ed8)", border: "none", color: "#fff", padding: "8px 14px", fontSize: "13px", fontWeight: 600, borderRadius: "6px", cursor: "pointer", width: "100%" },
  logH: { fontSize: "12px", color: "#8b96a3", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: "24px", marginBottom: "8px" },
  log: { fontFamily: "ui-monospace, monospace", fontSize: "11px", color: "#c0c8d2", background: "#0d1117", border: "1px solid #1f2933", borderRadius: "6px", padding: "12px", maxHeight: "260px", overflow: "auto", whiteSpace: "pre-wrap" as const, margin: 0 },
};
