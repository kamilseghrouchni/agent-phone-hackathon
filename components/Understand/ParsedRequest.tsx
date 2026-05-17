"use client";
import { useState, type ReactNode } from "react";
import type { ParseResult, ParsedField, DetectedAssay } from "@/app/api/parse/types";

export function ParsedRequest({
  parsed,
  rawQuery,
  onAssaysChange,
  action,
}: {
  parsed: ParseResult;
  rawQuery: string;
  onAssaysChange?: (assays: DetectedAssay[]) => void;
  action?: ReactNode;
}) {
  const fields = parsed.fields;
  const editable = typeof onAssaysChange === "function";
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftFamily, setDraftFamily] = useState("");

  function removeAssay(name: string) {
    if (!onAssaysChange) return;
    onAssaysChange(parsed.assays.filter((a) => a.assay !== name));
  }

  function commitAdd() {
    const name = draftName.trim();
    if (!name || !onAssaysChange) {
      cancelAdd();
      return;
    }
    if (parsed.assays.some((a) => a.assay.toLowerCase() === name.toLowerCase())) {
      cancelAdd();
      return;
    }
    const family = draftFamily.trim() || "custom";
    onAssaysChange([...parsed.assays, { assay: name, family, source: "stated", reason: "user added" }]);
    cancelAdd();
  }

  function cancelAdd() {
    setAdding(false);
    setDraftName("");
    setDraftFamily("");
  }

  return (
    <div className="parsed-request">
      <div className="pr-hd">
        <span className="pr-eyebrow">Here's what we heard</span>
        {action && <span className="pr-hd-right">{action}</span>}
      </div>

      <div className="pr-fields">
        {fields.length === 0 && (
          <div className="pr-empty">Nothing structured yet — we'll lean on the prose and the clarifiers.</div>
        )}
        {fields.map((f) => (
          <FieldRow key={f.key} f={f} />
        ))}
      </div>

      {(editable || (parsed.assays && parsed.assays.length > 0)) && (
        <div className="pr-assays">
          <div className="pr-assays-h">
            <span className="pr-assays-eyebrow mono-sm">Assays for this request</span>
            {parsed.assays.length === 0 && (
              <span className="pr-assays-meta mono-sm">none — add one if needed</span>
            )}
          </div>
          {parsed.assays.length > 0 && (
            <ul className="pr-assays-list">
              {parsed.assays.map((a) => (
                <li key={a.assay} className={`pr-assay src-${a.source}`}>
                  <span className="pr-assay-fam mono-sm">{a.family}</span>
                  <span className="pr-assay-name">{a.assay}</span>
                  <span className="pr-assay-tag mono-sm">
                    <span className={`pr-pip pr-pip-${a.source}`} />
                    {a.source === "stated" ? "STATED" : "INFERRED"}
                  </span>
                  {editable && (
                    <button
                      type="button"
                      className="pr-assay-x"
                      aria-label={`Remove ${a.assay}`}
                      title="Remove"
                      onClick={() => removeAssay(a.assay)}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {editable && (
            <div className="pr-assays-add">
              {adding ? (
                <div className="pr-assay-add-row">
                  <input
                    autoFocus
                    className="pr-assay-add-name"
                    placeholder="Assay name (e.g. RNA-seq)"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitAdd();
                      if (e.key === "Escape") cancelAdd();
                    }}
                  />
                  <input
                    className="pr-assay-add-fam"
                    placeholder="Family (optional)"
                    value={draftFamily}
                    onChange={(e) => setDraftFamily(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitAdd();
                      if (e.key === "Escape") cancelAdd();
                    }}
                  />
                  <button type="button" className="btn-p brand pr-assay-add-go" onClick={commitAdd}>
                    Add
                  </button>
                  <button type="button" className="btn-o pr-assay-add-cancel" onClick={cancelAdd}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" className="btn-o pr-assays-add-btn" onClick={() => setAdding(true)}>
                  + Add assay
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <details className="pr-raw">
        <summary>Original phrasing</summary>
        <div className="pr-raw-body">{rawQuery}</div>
      </details>
    </div>
  );
}

function FieldRow({ f }: { f: ParsedField }) {
  return (
    <div className={`pr-row src-${f.source}`}>
      <div className="pr-row-k mono-sm">{f.label}</div>
      <div className="pr-row-v">{f.value}</div>
      <div className="pr-row-tag mono-sm">
        <span className={`pr-pip pr-pip-${f.source}`} />
        {f.source === "stated" ? "STATED" : f.source === "inferred" ? "INFERRED" : "DEFAULT"}
      </div>
    </div>
  );
}
