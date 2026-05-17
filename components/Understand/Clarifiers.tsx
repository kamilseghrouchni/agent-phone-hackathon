"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { Clarifier, ClarifierAnswer } from "@/app/api/parse/types";

type Mode = "proposed" | "custom" | "skipped" | "answered";

type CardState = {
  mode: Mode;
  custom_text: string;
  selected_value: Clarifier["proposed_value"];
  selected_label: string;
};

export function Clarifiers({
  clarifiers,
  onAnswersChange,
  action,
}: {
  clarifiers: Clarifier[];
  onAnswersChange: (answers: ClarifierAnswer[]) => void;
  action?: ReactNode;
}) {
  const [states, setStates] = useState<Record<string, CardState>>(() => {
    const out: Record<string, CardState> = {};
    for (const c of clarifiers) {
      out[c.id] = {
        mode: "proposed",
        custom_text: "",
        selected_value: c.proposed_value,
        selected_label: c.proposed_label,
      };
    }
    return out;
  });

  useEffect(() => {
    const answers: ClarifierAnswer[] = clarifiers.map((c) => {
      const s = states[c.id];
      if (!s) return { id: c.id, value: c.proposed_value };
      if (s.mode === "skipped") return { id: c.id, value: null };
      if (s.mode === "custom") return { id: c.id, value: null, custom_text: s.custom_text };
      return { id: c.id, value: s.selected_value };
    });
    onAnswersChange(answers);
    // onAnswersChange is the parent's stable setter; states are the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states, clarifiers]);

  function patch(id: string, p: Partial<CardState>) {
    setStates((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));
  }

  if (clarifiers.length === 0) {
    return (
      <div className="clarifiers-empty">
        <span className="cl-eyebrow">Nothing to clarify</span>
        <p>You gave us enough — running the search now.</p>
      </div>
    );
  }

  return (
    <div className="clarifiers">
      <div className="cl-hd">
        <span className="cl-eyebrow">A few quick questions</span>
        <span className="cl-hd-right">{action}</span>
      </div>

      <div className="cl-list">
        {clarifiers.map((c) => (
          <ClarifierCard
            key={c.id}
            clarifier={c}
            state={states[c.id]}
            onPatch={(p) => patch(c.id, p)}
          />
        ))}
      </div>
    </div>
  );
}

function ClarifierCard({
  clarifier,
  state,
  onPatch,
}: {
  clarifier: Clarifier;
  state: CardState;
  onPatch: (p: Partial<CardState>) => void;
}) {
  const isAnswered = state.mode === "answered" || state.mode === "custom";
  const isSkipped = state.mode === "skipped";
  const cls = `cl-card ${isAnswered ? "answered" : isSkipped ? "skipped" : "proposed"}`;
  return (
    <div className={cls}>
      <div className="cl-card-hd">
        <div className="cl-q serif">{clarifier.question}</div>
        <span className="mono-sm cl-status">
          {isAnswered ? "✓ ANSWERED" : isSkipped ? "SKIPPED" : "PROPOSED"}
        </span>
      </div>
      <div className="cl-why">{clarifier.why}</div>

      {state.mode === "custom" ? (
        <input
          autoFocus
          className="cl-custom"
          value={state.custom_text}
          placeholder="Write your own answer…"
          onChange={(e) => onPatch({ custom_text: e.target.value })}
          onBlur={() => {
            if (state.custom_text.trim()) onPatch({ mode: "custom" });
            else onPatch({ mode: "proposed" });
          }}
        />
      ) : (
        <div className="cl-best">
          <div className="cl-best-k mono-sm">Our best guess</div>
          <div className="cl-best-v">{state.selected_label}</div>
        </div>
      )}

      {clarifier.options && clarifier.options.length > 1 && state.mode !== "custom" && (
        <div className="cl-opts">
          {clarifier.options.map((opt) => {
            const sel = state.selected_label === opt.label;
            return (
              <button
                key={opt.label}
                className={`cl-opt ${sel ? "on" : ""}`}
                onClick={() =>
                  onPatch({
                    mode: "answered",
                    selected_value: opt.value,
                    selected_label: opt.label,
                  })
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="cl-actions">
        {state.mode === "proposed" && (
          <button
            className="btn-p brand"
            onClick={() =>
              onPatch({
                mode: "answered",
                selected_value: clarifier.proposed_value,
                selected_label: clarifier.proposed_label,
              })
            }
          >
            Use this answer
          </button>
        )}
        {(isAnswered || isSkipped) && (
          <button
            className="btn-o cl-reset"
            onClick={() =>
              onPatch({
                mode: "proposed",
                selected_value: clarifier.proposed_value,
                selected_label: clarifier.proposed_label,
                custom_text: "",
              })
            }
          >
            ↶ Reset
          </button>
        )}
        <button
          className="btn-o cl-secondary"
          onClick={() => onPatch({ mode: "custom", custom_text: state.custom_text })}
        >
          Write my own
        </button>
        <button
          className={`btn-o cl-skip ${isSkipped ? "on" : ""}`}
          onClick={() => onPatch({ mode: isSkipped ? "proposed" : "skipped" })}
        >
          {isSkipped ? "Unskip" : "Skip"}
        </button>
      </div>
    </div>
  );
}
