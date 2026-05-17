"use client";

// Crovi.bio intake form — local target for Stage 1 Playwright form-fill.
//
// We own this page so the audience can WATCH the agent type 25 fields
// into a real, fully-rendered biospec procurement intake — instead of
// driving a third-party page whose layout / field set we don't control.
//
// Playwright targets fields by `input[name="<field_id>"]`. After submit
// the page swaps to a Crovi.bio-branded "Added to waitlist" panel — the
// text `Waitlist` is the signal chain-form.ts watches for.

import { useState, type FormEvent } from "react";

interface FieldSpec {
  id: string;
  label: string;
  group: string;
  type?: "text" | "textarea";
}

const FIELDS: FieldSpec[] = [
  // Client (sponsor) block — who's asking
  { group: "Client", id: "client.company", label: "Sponsor / company" },
  { group: "Client", id: "client.contact", label: "Procurement contact" },
  { group: "Client", id: "client.title", label: "Contact title" },
  { group: "Client", id: "client.email", label: "Contact email" },
  { group: "Client", id: "client.phone", label: "Contact phone" },
  { group: "Client", id: "client.study_name", label: "Study name" },
  { group: "Client", id: "client.timeline", label: "Required timeline" },

  // Project block — what for
  { group: "Project", id: "project.purpose", label: "Purpose / endpoint", type: "textarea" },
  { group: "Project", id: "project.therapeutic_area", label: "Therapeutic area" },
  { group: "Project", id: "project.irb_status", label: "IRB / ethics status" },
  { group: "Project", id: "project.consent", label: "Consent scope" },
  { group: "Project", id: "project.regulatory", label: "Regulatory pathway" },

  // Specimen block — what
  { group: "Specimen", id: "specimen.types", label: "Specimen types" },
  { group: "Specimen", id: "specimen.diagnosis", label: "Diagnosis (ICD-10 / freetext)" },
  { group: "Specimen", id: "specimen.quantity", label: "Quantity (cases / volume)" },
  { group: "Specimen", id: "specimen.timepoints", label: "Collection timepoints" },
  { group: "Specimen", id: "specimen.format", label: "Format (FFPE / frozen / fluid)" },
  { group: "Specimen", id: "specimen.min_volume", label: "Min volume / mass" },
  { group: "Specimen", id: "specimen.aliquot", label: "Aliquot / tube spec" },
  { group: "Specimen", id: "specimen.matched_normal", label: "Matched normal required?" },

  // Demographics + clinical block — who from
  { group: "Demographics", id: "demo.age_range", label: "Age range" },
  { group: "Demographics", id: "demo.disease_stage", label: "Disease stage" },
  { group: "Demographics", id: "demo.treatment_history", label: "Treatment-naive / line" },
  { group: "Demographics", id: "demo.biomarker", label: "Biomarker enrichment" },
  { group: "Demographics", id: "demo.inclusion", label: "Inclusion criteria", type: "textarea" },
];

const GROUP_ORDER = ["Client", "Project", "Specimen", "Demographics"];

export default function CroviIntakePage() {
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div style={brandStyle}>
          <span style={brandDotStyle} />
          <span style={brandTextStyle}>Crovi.bio</span>
          <span style={brandSubStyle}>Biospecimen Procurement Intake</span>
        </div>
        <div style={agentBadgeStyle}>agent-launched</div>
      </header>

      {submitted ? (
        <section style={waitlistStyle}>
          <h2 style={waitlistTitleStyle}>Added to waitlist</h2>
          <p style={waitlistBodyStyle}>
            We&apos;ve received your procurement intake. Allocation capacity
            verification required — a Crovi.bio BD will follow up by phone
            within 24h. Reference: <code>Waitlist</code>
          </p>
        </section>
      ) : (
        <form onSubmit={onSubmit} style={formStyle}>
          {GROUP_ORDER.map((group) => (
            <fieldset key={group} style={fieldsetStyle}>
              <legend style={legendStyle}>{group}</legend>
              <div style={gridStyle}>
                {FIELDS.filter((f) => f.group === group).map((f) =>
                  f.type === "textarea" ? (
                    <label key={f.id} style={fullStyle}>
                      <span style={labelStyle}>{f.label}</span>
                      <textarea
                        id={f.id}
                        name={f.id}
                        rows={2}
                        style={textareaStyle}
                      />
                    </label>
                  ) : (
                    <label key={f.id} style={cellStyle}>
                      <span style={labelStyle}>{f.label}</span>
                      <input
                        id={f.id}
                        name={f.id}
                        type="text"
                        style={inputStyle}
                        autoComplete="off"
                      />
                    </label>
                  ),
                )}
              </div>
            </fieldset>
          ))}

          <div style={submitRowStyle}>
            <button type="submit" name="submit" style={submitStyle}>
              Submit procurement request
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline styles — keeps the form self-contained (no global CSS dependency)
// and gives Playwright screenshots a clean, branded look.
// ---------------------------------------------------------------------------

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#0a0e14",
  color: "#e6edf3",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
  padding: "32px 48px",
  boxSizing: "border-box",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  paddingBottom: "20px",
  borderBottom: "1px solid #1f2933",
  marginBottom: "24px",
};

const brandStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
};

const brandDotStyle: React.CSSProperties = {
  width: "12px",
  height: "12px",
  borderRadius: "50%",
  background: "linear-gradient(135deg, #6ee7b7, #3b82f6)",
};

const brandTextStyle: React.CSSProperties = {
  fontSize: "20px",
  fontWeight: 600,
  letterSpacing: "-0.01em",
};

const brandSubStyle: React.CSSProperties = {
  fontSize: "13px",
  color: "#8b96a3",
  marginLeft: "12px",
};

const agentBadgeStyle: React.CSSProperties = {
  fontSize: "11px",
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  color: "#6ee7b7",
  border: "1px solid #1f4d3a",
  borderRadius: "4px",
  padding: "3px 8px",
  background: "#0f1f17",
};

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

const fieldsetStyle: React.CSSProperties = {
  border: "1px solid #1f2933",
  borderRadius: "8px",
  padding: "16px 18px",
  background: "#0d1117",
};

const legendStyle: React.CSSProperties = {
  padding: "0 6px",
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#8b96a3",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "10px 16px",
};

const cellStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

const fullStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  gridColumn: "1 / -1",
};

const labelStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "#8b96a3",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const inputStyle: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #2d3744",
  borderRadius: "4px",
  padding: "7px 10px",
  color: "#e6edf3",
  fontSize: "13px",
  fontFamily: "inherit",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  minHeight: "42px",
  fontFamily: "inherit",
};

const submitRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  paddingTop: "8px",
};

const submitStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
  border: "none",
  color: "#fff",
  padding: "10px 18px",
  fontSize: "14px",
  fontWeight: 600,
  borderRadius: "6px",
  cursor: "pointer",
};

const waitlistStyle: React.CSSProperties = {
  maxWidth: "560px",
  margin: "80px auto 0",
  textAlign: "center",
  padding: "32px",
  background: "#0d1117",
  border: "1px solid #1f2933",
  borderRadius: "8px",
};

const waitlistTitleStyle: React.CSSProperties = {
  fontSize: "22px",
  margin: "0 0 12px",
  color: "#f0b429",
};

const waitlistBodyStyle: React.CSSProperties = {
  fontSize: "14px",
  color: "#c0c8d2",
  lineHeight: 1.55,
};
