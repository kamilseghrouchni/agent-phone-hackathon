"use client";
import { useEffect, useRef, useState } from "react";
import type { IntakeForm, IntakeField } from "@/types/intake";
import { groupBySection, SECTION_TITLES } from "@/lib/intake/categorize";

/**
 * FullIntakeAccordion — always-open 50-field preview, grouped by section.
 *
 * Despite the legacy name, this is no longer collapsible. Buyers should see
 * exactly what the agent extracted on the Confirm beat — no fold, no friction.
 *
 * Editing model (added Beat 2.6):
 *   - frozen + agent_filled rows  → read-only (locked / future evidence)
 *   - confirmable + updatable rows → click the value to inline-edit, hit
 *     Enter to commit (or Escape to cancel). Commit fires `onChange` with
 *     the patched IntakeForm so the workspace page can mirror to sessionStorage.
 *
 * When `onChange` is omitted the component falls back to the original
 * read-only behaviour so it stays usable in non-editable contexts.
 */
export function FullIntakeAccordion({
  intake,
  onChange,
}: {
  intake: IntakeForm;
  onChange?: (next: IntakeForm) => void;
}) {
  return <IntakePreview intake={intake} onChange={onChange} />;
}

export function IntakePreview({
  intake,
  onChange,
}: {
  intake: IntakeForm;
  onChange?: (next: IntakeForm) => void;
}) {
  const groups = groupBySection(intake);

  function patchField(field_id: string, value: string) {
    if (!onChange) return;
    const fields = intake.fields.map((f) =>
      f.field_id === field_id
        ? {
            ...f,
            value,
            // Bump status so the row visibly marks itself "updated" once
            // the user has edited it. Frozen/agent_filled never reach
            // patchField (Row gates on `isEditable`).
            status: f.class === "confirmable" ? "confirmed" : "updated",
          }
        : f,
    );
    onChange({ ...intake, fields } as IntakeForm);
  }

  return (
    <section className="ip">
      <div className="ip-hd">
        <div>
          <div className="ip-eyebrow mono-sm">What we read from your PDF</div>
          <h3 className="serif ip-title">
            Intake preview · {intake.fields.length} fields
            {onChange ? <span className="ip-edit-hint mono-sm"> · click any unlocked row to edit</span> : null}
          </h3>
        </div>
        <div className="ip-legend mono-sm">
          <span className="ip-legend-item"><i className="ip-dot ip-dot-frozen" />frozen</span>
          <span className="ip-legend-item"><i className="ip-dot ip-dot-confirmable" />to confirm</span>
          <span className="ip-legend-item"><i className="ip-dot ip-dot-updatable" />updatable</span>
          <span className="ip-legend-item"><i className="ip-dot ip-dot-agent" />agent-filled</span>
        </div>
      </div>

      <div className="ip-sections">
        {groups.map(({ section, fields }) => (
          <section key={section} className="ip-section">
            <header className="ip-section-hd">
              <span className="mono-sm ip-section-num">§{section}</span>
              <h4 className="ip-section-title">{SECTION_TITLES[section] ?? ""}</h4>
              <span className="mono-sm ip-section-count">{fields.length}</span>
            </header>
            <dl className="ip-rows">
              {fields.map((f) => (
                <Row
                  key={f.field_id}
                  field={f}
                  onCommit={onChange ? (v) => patchField(f.field_id, v) : undefined}
                />
              ))}
            </dl>
          </section>
        ))}
      </div>
    </section>
  );
}

function Row({
  field,
  onCommit,
}: {
  field: IntakeField;
  onCommit?: (value: string) => void;
}) {
  // Frozen rows are by definition locked. Agent-filled rows are filled in by
  // future evidence (§7/§8) so we leave them alone too — letting the buyer
  // pre-fill them would defeat the demo's "agents do the work" message.
  const isEditable =
    !!onCommit && (field.class === "confirmable" || field.class === "updatable");

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stringify(field.value));
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep draft in sync if the field value mutates outside this row.
  useEffect(() => {
    if (!editing) setDraft(stringify(field.value));
  }, [field.value, editing]);

  // Focus + select on entering edit mode.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function commit() {
    setEditing(false);
    if (!onCommit) return;
    if (draft === stringify(field.value)) return; // no-op
    onCommit(draft);
  }

  function cancel() {
    setDraft(stringify(field.value));
    setEditing(false);
  }

  const v = stringify(field.value);

  return (
    <div className={`ip-row klass-${field.class} ${isEditable ? "is-editable" : ""} ${editing ? "is-editing" : ""}`}>
      <dt className="ip-lbl">{field.label}</dt>
      <dd className="ip-val">
        {editing ? (
          <input
            ref={inputRef}
            className="ip-val-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
          />
        ) : isEditable ? (
          <button
            type="button"
            className="ip-val-edit-btn"
            onClick={() => {
              setDraft(stringify(field.value));
              setEditing(true);
            }}
            aria-label={`Edit ${field.label}`}
          >
            {v ? <span className="ip-val-text">{v}</span> : <span className="ip-empty">—</span>}
            <span className="ip-val-pencil" aria-hidden>
              ✎
            </span>
          </button>
        ) : (
          v ? <span className="ip-val-text">{v}</span> : <span className="ip-empty">—</span>
        )}
      </dd>
      <span className={`ip-badge status-${field.status}`} title={field.status}>
        {badge(field.status)}
      </span>
    </div>
  );
}

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function badge(status: string): string {
  switch (status) {
    case "frozen":
      return "🔒 frozen";
    case "confirmed":
      return "✓ confirmed";
    case "updated":
      return "↻ updated";
    case "agent_filled":
      return "🤖 agent";
    case "empty":
    default:
      return "·";
  }
}
