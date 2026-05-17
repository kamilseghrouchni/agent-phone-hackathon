"use client";
import { useEffect, useState } from "react";
import type { SpecimenRow } from "@/lib/tools/query_specimens";
import { parsePathologyNotes, diagnosesEqual } from "@/lib/pathology";

export function SpecimenDrawer({
  row,
  instituteName,
  onClose,
}: {
  row: SpecimenRow | null;
  instituteName?: string;
  onClose: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const [showIds, setShowIds] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!row) return null;

  const raw: any = row.raw ?? {};
  const tas: Record<string, number | null> = raw.specimen_tas ?? raw.donor_tas ?? {};
  const tasEntries = Object.entries(tas).filter(([, v]) => typeof v === "number") as [string, number][];
  tasEntries.sort((a, b) => b[1] - a[1]);

  const collDate = raw.date_of_collection ?? {};
  const dateStr = collDate.year
    ? `${collDate.year}${collDate.month ? "-" + String(collDate.month).padStart(2, "0") : ""}${collDate.day ? "-" + String(collDate.day).padStart(2, "0") : ""}`
    : null;

  const donorDx = parseList(row.donor_diagnoses ?? raw.donor_diagnoses);
  const specDx = parseList(row.specimen_diagnoses ?? raw.specimen_diagnoses);
  const dxIdentical = donorDx.length > 0 && diagnosesEqual(donorDx, specDx);
  const donorTx = parseList(raw.donor_treatments);
  const specTx = parseList(raw.specimen_treatments);
  const txIdentical = donorTx.length > 0 && diagnosesEqual(donorTx, specTx);
  const unstructMeasurements = parseList(raw.unstructured_measurements);
  const pathology = parsePathologyNotes(row.unstructured_pathology);
  const sm: Record<string, any> = raw.structured_measurements ?? {};
  const pmi = sm["post-mortem interval"] ?? sm["post_mortem_interval"] ?? null;

  const txStatusLabel = row.treatment_status && row.treatment_status !== "unknown"
    ? row.treatment_status === "naive" ? "Treatment-naive" : "Post-treatment"
    : null;

  // Header summary numbers
  const tnmStr = row.tnm
    ? `T${row.tnm.T ?? "?"} N${row.tnm.N ?? "?"} M${row.tnm.M ?? "?"}`
    : null;

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="drawer-hd">
          <div className="lead">
            <div className="lbl">Specimen entry · {instituteName ?? "—"}</div>
            <div className="id">{row.external_specimen_id ?? row.specimen_id}</div>
            <div className="ttl">{stripPrefix(row.raw_anatomy) ?? row.specimen_type ?? "—"}</div>
            <div className="sub">{row.specimen_type ?? ""}</div>
          </div>
          {tnmStr && (
            <div className="meta-col">
              <span className="k">TNM</span>
              <span className="v" style={{ fontFamily: "var(--mono)", fontSize: 14, letterSpacing: ".06em" }}>{tnmStr}</span>
            </div>
          )}
          {row.stage && (
            <div className="meta-col">
              <span className="k">Stage</span>
              <span className="v">{row.stage}</span>
            </div>
          )}
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="dr-grid-cols">
          {/* Lead with the high-signal pathology + diagnoses */}
          {(row.tnm || row.grade || row.stage || row.tumor_percentage != null || row.viable_tissue_percentage != null || pathology?.measurements.tumor_size || pathology?.measurements.clark_level || pathology?.measurements.breslow_depth || pathology?.measurements.pT || pathology?.measurements.pN || pathology?.measurements.pM || pathology?.measurements.lvi || pathology?.measurements.pni || pathology?.measurements.resection_margin || pathology?.measurements.icd_o_code) && (
            <Card title="Pathology measurements">
              {row.tnm?.T != null && <Row k="T (clinical)" v={row.tnm.T} />}
              {row.tnm?.N != null && <Row k="N (clinical)" v={row.tnm.N} />}
              {row.tnm?.M != null && <Row k="M (clinical)" v={row.tnm.M} />}
              {pathology?.measurements.pT && <Row k="pT" v={pathology.measurements.pT} />}
              {pathology?.measurements.pN && <Row k="pN" v={pathology.measurements.pN} />}
              {pathology?.measurements.pM && <Row k="pM" v={pathology.measurements.pM} />}
              {row.grade && <Row k="Grade" v={row.grade} />}
              {row.stage && <Row k="Stage" v={row.stage} />}
              {pathology?.measurements.tumor_size && <Row k="Tumor size" v={pathology.measurements.tumor_size} />}
              {pathology?.measurements.clark_level && <Row k="Clark level" v={pathology.measurements.clark_level} />}
              {pathology?.measurements.breslow_depth && <Row k="Breslow depth" v={pathology.measurements.breslow_depth} />}
              {pathology?.measurements.lvi && <Row k="Lymphovascular invasion" v={pathology.measurements.lvi} />}
              {pathology?.measurements.pni && <Row k="Perineural invasion" v={pathology.measurements.pni} />}
              {pathology?.measurements.resection_margin && <Row k="Resection margin" v={pathology.measurements.resection_margin} />}
              {pathology?.measurements.icd_o_code && <Row k="ICD-O code" v={pathology.measurements.icd_o_code} mono />}
              {row.tumor_percentage != null && <Row k="Tumor %" v={row.tumor_percentage} />}
              {row.viable_tissue_percentage != null && <Row k="Viable %" v={row.viable_tissue_percentage} />}
            </Card>
          )}

          {(donorDx.length > 0 || specDx.length > 0) && (
            <Card title="Extracted diagnoses">
              {donorDx.length > 0 && <SubList label="Donor" items={donorDx} />}
              {dxIdentical
                ? <SameAsDonor label="Specimen" />
                : specDx.length > 0 && <SubList label="Specimen" items={specDx} />}
            </Card>
          )}

          <Card title="Donor demographics">
            <Row k="Sex" v={row.sex ?? <None />} />
            <Row k="Age at collection" v={row.age != null ? `${row.age} years` : <None />} />
            <Row k="Donor race" v={row.donor_race ?? <None text="not stated" />} />
            <Row k="Country of origin" v={row.country ?? <None />} />
            <Row k="Date of collection" v={dateStr ?? <None text="not recorded" />} />
            {pmi != null && pmi !== "" && <Row k="Post-mortem interval" v={String(pmi)} />}
          </Card>

          <Card title="Specimen attributes">
            <Row k="Specimen type" v={row.specimen_type ?? "—"} />
            <Row k="Anatomy" v={stripPrefix(row.raw_anatomy) ?? row.source_site ?? <None />} />
            <Row k="Source site" v={row.source_site ?? <None />} />
            <Row k="Preservation method" v={row.preservation_category ?? <None />} />
            {row.preservation_detail && <Row k="Preservation details" v={row.preservation_detail} />}
            {row.storage_temp && <Row k="Storage temp" v={row.storage_temp} mono />}
            <Row k="Status" v={raw.specimen_status ?? <None />} />
            <Row k="Quantity" v={raw.quantity ?? <None />} />
          </Card>

          {(donorTx.length > 0 || specTx.length > 0 || row.treatment_summary || txStatusLabel) && (
            <Card title="Treatments">
              {txStatusLabel && <Row k="Status" v={txStatusLabel} />}
              {donorTx.length > 0 && <SubList label="Donor" items={donorTx} />}
              {txIdentical
                ? <SameAsDonor label="Specimen" />
                : specTx.length > 0 && <SubList label="Specimen" items={specTx} />}
              {row.treatment_summary && <div className="body">{row.treatment_summary}</div>}
            </Card>
          )}

          {unstructMeasurements.length > 0 && (
            <Card title="Other measurements">
              <ul className="dx-list">{unstructMeasurements.map((m, i) => <li key={i}>{m}</li>)}</ul>
            </Card>
          )}

          {pathology && (
            <Card title="Pathology" full>
              {pathology.sections.map((sec, i) => {
                if (/^(pathology report|histopathological diagnosis|main diagnosis( and complications)?)$/i.test(sec.label)) {
                  return (
                    <div className="row pathology-row" key={i}>
                      <span className="k">{sec.label}</span>
                      <div className="v">{sec.value}</div>
                    </div>
                  );
                }
                if (/^concomitant diseases$/i.test(sec.label) && pathology.concomitant_diseases?.length) {
                  return (
                    <div className="row pathology-row" key={i}>
                      <span className="k">{sec.label}</span>
                      <ul className="v dx-list inline-ul">
                        {pathology.concomitant_diseases.map((d, j) => <li key={j}>{d}</li>)}
                      </ul>
                    </div>
                  );
                }
                if (pathology.serologies && /(hiv|hcv|hbsag|syphilis)/i.test(sec.label) && /,/.test(sec.label)) {
                  return (
                    <div key={i}>
                      {pathology.serologies.map((s, j) => (
                        <Row key={j} k={s.agent} v={s.result} />
                      ))}
                    </div>
                  );
                }
                return <Row key={i} k={sec.label} v={sec.value} />;
              })}
            </Card>
          )}

          {raw.unstructured_clinical_data && (
            <Card title="Clinical notes" full>
              <div className="body">{raw.unstructured_clinical_data}</div>
            </Card>
          )}

          {tasEntries.length > 0 && (
            <Card title="Therapeutic-area scores" full>
              <div className="tas-grid">
                {tasEntries.map(([area, v]) => (
                  <div key={area} className="tas-row">
                    <span className="label">{area}</span>
                    <div className="bar"><span style={{ width: `${Math.min(100, v * 100)}%` }} /></div>
                    <span className="num">{v.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Footer: identifiers + raw — collapsed by default, low priority */}
          <Card title="Records · plumbing" full>
            <button className="raw-toggle" onClick={() => setShowIds((s) => !s)}>
              {showIds ? "▾ Hide identifiers" : "▸ Show identifiers"}
            </button>
            {showIds && (
              <div className="rows" style={{ borderTop: "1px dashed var(--bg-sunk)" }}>
                <Row k="Internal" v={row.specimen_id} mono />
                {row.donor_id && <Row k="Donor" v={row.donor_id} mono />}
                {row.external_specimen_id && <Row k="External specimen" v={row.external_specimen_id} mono />}
                {row.external_donor_id && <Row k="External donor" v={row.external_donor_id} mono />}
                {raw.organization_id && <Row k="Organization" v={raw.organization_id} mono />}
                {raw.document_id && <Row k="Document" v={raw.document_id} mono />}
              </div>
            )}
            <button className="raw-toggle" onClick={() => setShowRaw((s) => !s)}>
              {showRaw ? "▾ Hide raw JSON" : "▸ Show raw JSON"}
            </button>
            {showRaw && <pre className="raw-json">{JSON.stringify(raw, null, 2)}</pre>}
          </Card>
        </div>
      </aside>
    </div>
  );
}

function Card({ title, full, children }: { title: string; full?: boolean; children: React.ReactNode }) {
  return (
    <section className={`dr-card ${full ? "full" : ""}`}>
      <div className="title">{title}</div>
      <div className="rows">{children}</div>
    </section>
  );
}

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="row">
      <span className="k">{k}</span>
      <span className={`v ${mono ? "mono" : ""}`}>{v}</span>
    </div>
  );
}

function None({ text = "—" }: { text?: string }) {
  return <span className="none">{text}</span>;
}

function SameAsDonor({ label }: { label: string }) {
  return (
    <div style={{ padding: "8px 16px 12px" }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" }}>{label}</span>
      <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-2)", fontStyle: "italic" }}>same as donor</div>
    </div>
  );
}

function SubList({ label, items }: { label: string; items: string[] }) {
  return (
    <>
      <div style={{ padding: "8px 16px 0" }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" }}>{label}</span>
      </div>
      <ul className="dx-list">{items.map((d, i) => <li key={i}>{d}</li>)}</ul>
    </>
  );
}

function parseList(s: any): string[] {
  if (!s) return [];
  if (Array.isArray(s)) return s.filter(Boolean).map(String);
  if (typeof s === "string") {
    try {
      const p = JSON.parse(s);
      if (Array.isArray(p)) return p.filter(Boolean).map(String);
    } catch {}
    return [s];
  }
  return [];
}

function stripPrefix(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.replace(/^anatomic_site:\s*/i, "").trim();
}
