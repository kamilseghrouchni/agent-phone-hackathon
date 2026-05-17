"use client";

// Per-stage test cockpit. Sits below SequenceTemplate inside the chain
// phase. Each row: stage label, current status pill, latest event text,
// "Fire" button that hits /api/chain/fire-stage with this stage. The
// endpoint synthesizes prior stages as complete then fires only the
// target stage — lets you validate each integration's real wire in
// isolation, in parallel with the natural cascade if you want.

import { useState } from "react";
import type { ChainState, ChainStage } from "@/types/chain";

const STAGES: ChainStage[] = ["form", "call", "email", "sms_pay", "meeting"];

const LABEL: Record<ChainStage, string> = {
  form: "1. FORM",
  call: "2. CALL",
  email: "3. EMAIL",
  sms_pay: "4. SMS + PAY",
  meeting: "5. MEETING",
};

const HINT: Record<ChainStage, string> = {
  form: "Playwright fills /forms/crovi-intake — 25 fields, paced typing",
  call: "AgentPhone calls your phone with Crovi-AI operator",
  email: "AgentMail sends Filled Intake + Quote",
  sms_pay: "SMS-stub + Sponge-stub (10DLC/KYC pending) → 'Funds wired'",
  meeting: "Playwright drives Notion calendar booking",
};

interface Props {
  runId: string;
  chain: ChainState;
  supplierId?: string;
}

export function StageControls({ runId, chain, supplierId = "crovi_bio" }: Props) {
  const [busy, setBusy] = useState<ChainStage | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const fire = async (stage: ChainStage) => {
    setBusy(stage);
    const t = new Date().toISOString().slice(11, 19);
    setLog((l) => [`[${t}] fire ${stage}…`, ...l].slice(0, 12));
    try {
      const endpoint =
        stage === "form" ? "/api/chain/start" : "/api/chain/fire-stage";
      const body =
        stage === "form"
          ? { runId, supplierId }
          : { runId, stage, supplierId };
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      const t2 = new Date().toISOString().slice(11, 19);
      setLog((l) => [`[${t2}] ${stage} → ${r.status} · ${JSON.stringify(j).slice(0, 100)}`, ...l].slice(0, 12));
    } catch (e) {
      const t2 = new Date().toISOString().slice(11, 19);
      setLog((l) => [`[${t2}] ${stage} ERROR · ${e instanceof Error ? e.message : String(e)}`, ...l].slice(0, 12));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="sc-wrap">
      <div className="sc-head">
        <span className="mono-sm">Stage cockpit</span>
        <span className="sc-help mono-sm">
          Click any stage to fire it in isolation — prior stages auto-synth as
          complete. Real wire fires for the target stage only.
        </span>
      </div>
      <div className="sc-grid">
        {STAGES.map((s) => {
          const st = chain.stages[s] ?? { status: "locked", events: [] };
          const last = st.events?.length > 0 ? st.events[st.events.length - 1] : null;
          return (
            <div key={s} className={`sc-row sc-status-${st.status}`}>
              <div className="sc-l">
                <div className="sc-name">{LABEL[s]}</div>
                <div className="sc-hint">{HINT[s]}</div>
              </div>
              <div className="sc-m">
                <span className={`sc-pill sc-pill-${st.status}`}>{st.status}</span>
                <span className="sc-count">{st.events?.length ?? 0} ev</span>
                <span className="sc-last">{last?.text ? last.text.slice(0, 90) : ""}</span>
              </div>
              <div className="sc-r">
                <button
                  type="button"
                  className="sc-btn"
                  disabled={busy === s}
                  onClick={() => fire(s)}
                  title={s === "form" ? "Run /api/chain/start (full chain from top)" : `Synth prior + fire ${s} only`}
                >
                  {busy === s ? "…" : `Fire ${s}`}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {log.length > 0 && (
        <pre className="sc-log">{log.join("\n")}</pre>
      )}
      <style jsx>{`
        .sc-wrap { background: rgba(13, 17, 23, 0.6); border: 1px solid rgba(31, 41, 51, 0.8); border-radius: 8px; padding: 14px 16px; margin: 12px 0; }
        .sc-head { display: flex; align-items: baseline; gap: 16px; margin-bottom: 12px; }
        .sc-help { color: #8b96a3; font-size: 11px; }
        .sc-grid { display: flex; flex-direction: column; gap: 6px; }
        .sc-row { display: grid; grid-template-columns: minmax(220px, 280px) 1fr 130px; gap: 12px; align-items: center; padding: 8px 12px; background: #0d1117; border: 1px solid #1f2933; border-radius: 6px; }
        .sc-row.sc-status-in_progress { border-color: #3b82f677; }
        .sc-row.sc-status-complete { border-color: #10b98155; }
        .sc-row.sc-status-failed { border-color: #ef444477; }
        .sc-name { font-size: 13px; font-weight: 600; color: #e6edf3; }
        .sc-hint { font-size: 10.5px; color: #8b96a3; margin-top: 2px; line-height: 1.35; }
        .sc-m { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .sc-pill { padding: 2px 8px; border-radius: 3px; font-size: 10px; font-family: ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.05em; }
        .sc-pill-locked { background: #6b728033; color: #6b7280; }
        .sc-pill-ready { background: #9ca3af33; color: #9ca3af; }
        .sc-pill-in_progress { background: #3b82f633; color: #60a5fa; }
        .sc-pill-complete { background: #10b98133; color: #34d399; }
        .sc-pill-failed { background: #ef444433; color: #f87171; }
        .sc-pill-fallback { background: #f59e0b33; color: #fbbf24; }
        .sc-count { font-size: 10.5px; color: #8b96a3; font-family: ui-monospace, monospace; }
        .sc-last { font-size: 11px; color: #c0c8d2; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; }
        .sc-r { text-align: right; }
        .sc-btn { background: linear-gradient(135deg, #3b82f6, #1d4ed8); border: none; color: #fff; padding: 6px 12px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; width: 100%; }
        .sc-btn:disabled { opacity: 0.5; cursor: wait; }
        .sc-log { font-family: ui-monospace, monospace; font-size: 10.5px; color: #c0c8d2; background: #07090d; border: 1px solid #1f2933; border-radius: 4px; padding: 8px 10px; margin-top: 10px; max-height: 140px; overflow: auto; white-space: pre-wrap; }
      `}</style>
    </div>
  );
}
