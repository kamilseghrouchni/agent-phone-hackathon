"use client";
import { useState } from "react";

export type LaunchAgent = {
  label: string;
  detail: string;
};

export function LaunchButton({
  opportunityTitle,
  agents,
}: {
  opportunityTitle: string;
  agents: LaunchAgent[];
}) {
  const [stage, setStage] = useState<"idle" | "confirm" | "launching" | "launched">("idle");
  const [progress, setProgress] = useState(0);

  const dispatch = () => {
    setStage("launching");
    setProgress(0);
    // Walk through the agent list one tick at a time so the user sees each
    // dispatch land before we flip to the launched state.
    let i = 0;
    const tick = () => {
      i += 1;
      setProgress(i);
      if (i < agents.length) {
        setTimeout(tick, 700);
      } else {
        setTimeout(() => setStage("launched"), 600);
      }
    };
    setTimeout(tick, 500);
  };

  if (stage === "launched") {
    return (
      <div className="opp-launch opp-launch-done">
        <div className="opp-launch-title serif">Generation in motion.</div>
        <div className="opp-launch-sub">
          {agents.length} agents dispatched · status posts to your inbox · first milestone tracked on the timeline above.
        </div>
        <ul className="opp-launch-agents">
          {agents.map((a, i) => (
            <li key={i} className="done">
              <span className="opp-tick" aria-hidden="true">✓</span>
              <span className="opp-agent-l">{a.label}</span>
              <span className="opp-agent-d">{a.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (stage === "launching") {
    return (
      <div className="opp-launch opp-launch-running">
        <div className="opp-launch-title serif">Dispatching agents…</div>
        <ul className="opp-launch-agents">
          {agents.map((a, i) => (
            <li key={i} className={i < progress ? "done" : i === progress ? "active" : "queued"}>
              <span className="opp-tick" aria-hidden="true">
                {i < progress ? "✓" : i === progress ? "•" : "○"}
              </span>
              <span className="opp-agent-l">{a.label}</span>
              <span className="opp-agent-d">{a.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (stage === "confirm") {
    return (
      <div className="opp-launch opp-launch-confirm">
        <div className="opp-launch-title serif">Authorise dispatch.</div>
        <p className="opp-launch-body">
          This commits Crovi to start outreach on <b>{opportunityTitle}</b>: DUA negotiation with Neuro C-BIG, MSA lock with Metabolon, and milestone tracking until data delivery. The mock contract above is the basis for the legal touchpoint.
        </p>
        <ul className="opp-launch-agents preview">
          {agents.map((a, i) => (
            <li key={i}>
              <span className="opp-tick" aria-hidden="true">○</span>
              <span className="opp-agent-l">{a.label}</span>
              <span className="opp-agent-d">{a.detail}</span>
            </li>
          ))}
        </ul>
        <div className="opp-launch-actions">
          <button className="btn-o" onClick={() => setStage("idle")} type="button">Back</button>
          <button className="btn-p brand" onClick={dispatch} type="button">Authorise + dispatch</button>
        </div>
      </div>
    );
  }

  return (
    <div className="opp-launch">
      <div className="opp-launch-title serif">Ready to launch generation.</div>
      <div className="opp-launch-sub">
        Two providers, one contract, milestones gated. Click to review the dispatch list and authorise the agent suite.
      </div>
      <button className="btn-p brand opp-launch-cta" onClick={() => setStage("confirm")} type="button">
        Launch generation →
      </button>
    </div>
  );
}
