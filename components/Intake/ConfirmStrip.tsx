"use client";
import { useState } from "react";
import type { IntakeForm, IntakeField } from "@/types/intake";
import { SEARCH_KEY_FIELDS } from "@/lib/intake/categorize";

/**
 * ConfirmStrip — Beat 2 top strip with 6 search-key chips, each inline-editable.
 * Below the chips, callers render the collapsible FullIntakeAccordion.
 */
export function ConfirmStrip({
  intake,
  onChange,
  onLaunch,
}: {
  intake: IntakeForm;
  onChange: (intake: IntakeForm) => void;
  onLaunch: () => void;
}) {
  const studyName = pickValue(intake, "client.study_name") ?? "Intake";
  const timeline = pickValue(intake, "client.timeline") ?? "";
  const company = intake.buyer.company || pickValue(intake, "client.company") || "";

  function patchField(field_id: string, value: string) {
    const fields = intake.fields.map((f) =>
      f.field_id === field_id ? { ...f, value } : f,
    );
    onChange({ ...intake, fields });
  }

  return (
    <div className="cs-wrap">
      <div className="cs-hd">
        <div className="cs-title-row">
          <h2 className="cs-title serif">
            {company ? `${company} × ` : ""}
            {studyName}
          </h2>
          {timeline && <span className="cs-timeline mono-sm">{timeline}</span>}
        </div>
        <div className="cs-sub mono-sm">Confirm the 6 search keys · everything else stays read-only below</div>
      </div>

      <div className="cs-chips">
        {SEARCH_KEY_FIELDS.map(({ field_id, label }) => {
          const f = intake.fields.find((x) => x.field_id === field_id);
          if (!f) return null;
          return (
            <Chip
              key={field_id}
              label={label}
              field={f}
              onChange={(v) => patchField(field_id, v)}
            />
          );
        })}
      </div>

      <div className="cs-cta">
        <button className="btn-p brand" onClick={onLaunch}>
          Launch enrichment →
        </button>
      </div>
    </div>
  );
}

function Chip({
  label,
  field,
  onChange,
}: {
  label: string;
  field: IntakeField;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stringify(field.value));

  function commit() {
    setEditing(false);
    onChange(draft);
  }

  return (
    <div className={`cs-chip ${editing ? "editing" : ""} ${classOf(field)}`}>
      <div className="cs-chip-lbl mono-sm">{label}</div>
      {editing ? (
        <textarea
          autoFocus
          className="cs-chip-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              setDraft(stringify(field.value));
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          className="cs-chip-val"
          onClick={() => {
            setDraft(stringify(field.value));
            setEditing(true);
          }}
        >
          {stringify(field.value) || <span className="cs-chip-empty">—</span>}
          <span className="cs-chip-edit" aria-hidden>✎</span>
        </button>
      )}
    </div>
  );
}

function classOf(f: IntakeField): string {
  if (f.class === "frozen") return "frozen";
  if (f.class === "updatable") return "updatable";
  return "confirmable";
}

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function pickValue(intake: IntakeForm, field_id: string): string | null {
  const f = intake.fields.find((x) => x.field_id === field_id);
  return f ? stringify(f.value) || null : null;
}
