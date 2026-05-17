"use client";
import { useEffect, useMemo, useState } from "react";
import type { ParseResult } from "@/app/api/parse/types";
import type { QuerySpecimensResult, InstituteEntry } from "@/lib/tools/query_specimens";
import type { Bundle } from "@/lib/bundle";
import type { ProspectiveCard } from "@/lib/prospective";
import {
  startRun,
  listSuppliers,
  stageAll,
  confirmOne,
  type StagedActionPreview,
} from "@/lib/dispatch-client";

type Step = "prompt" | "audit" | "bundle" | "prospective" | "campaign" | "dispatch";

// Default audit checklist for a banked-institute "launch an audit" flow.
// The user already has the institute on file — these are the deeper protocol /
// storage / collection questions an agent goes back to the steward to confirm
// before any specimen actually moves.
type AuditItemDef = { id: string; title: string; detail: string };
const AUDIT_ITEMS: AuditItemDef[] = [
  {
    id: "inventory",
    title: "Sample inventory",
    detail: "Confirm current freezer counts and residual aliquot volume per donor.",
  },
  {
    id: "consent",
    title: "Consent + IRB scope",
    detail: "Verify the protocol covers our intended secondary use (and any commercial use).",
  },
  {
    id: "integrity",
    title: "Specimen integrity",
    detail: "Storage temperature history, freeze-thaw count, container/tube format.",
  },
  {
    id: "metadata",
    title: "Linked metadata",
    detail: "Clinical fields available + delivery format (CRF, REDCap export, EHR pull).",
  },
  {
    id: "pricing",
    title: "Pricing + DUA",
    detail: "Per-specimen cost, DUA template, MTA timeline.",
  },
  {
    id: "leadtime",
    title: "Lead time",
    detail: "Retrieval → shipping turnaround in business days.",
  },
];

// Bundle launch — agents have to audit each leg AND negotiate across legs
// before any contract is signed. Three groups of items.
const BUNDLE_INSTITUTE_ITEMS: AuditItemDef[] = [
  {
    id: "i_inventory",
    title: "Sample inventory",
    detail: "Confirm freezer counts and residual aliquot volume for the picked specimens.",
  },
  {
    id: "i_consent",
    title: "Consent + IRB scope",
    detail: "Verify protocol covers our intended use; flag commercial-use restrictions.",
  },
  {
    id: "i_integrity",
    title: "Specimen integrity",
    detail: "Storage temperature history, freeze-thaw, container/tube compatibility with the picked assays.",
  },
  {
    id: "i_leadtime",
    title: "Retrieval lead time",
    detail: "Pull → ship turnaround per institute, on the size we'd actually order.",
  },
  {
    id: "i_dua",
    title: "MTA / DUA terms",
    detail: "Template review, redline tolerance, signature timeline.",
  },
];

const BUNDLE_PROVIDER_ITEMS: AuditItemDef[] = [
  {
    id: "p_capacity",
    title: "Assay capacity",
    detail: "Open slots in the next 8 weeks at the volume we need.",
  },
  {
    id: "p_validation",
    title: "Validation + QC",
    detail: "Confirm assay version, validation status, accepted input formats.",
  },
  {
    id: "p_turnaround",
    title: "Turnaround time",
    detail: "Receipt → preliminary results → final report, business days.",
  },
  {
    id: "p_pricing",
    title: "Pricing tiers",
    detail: "Per-sample list price, volume break, rush surcharge, data-delivery fee.",
  },
  {
    id: "p_data",
    title: "Data delivery format",
    detail: "Raw vs processed, schema, transfer mechanism (S3, FTP, portal).",
  },
];

// Prospective lead — the partner has the population + has done it before but
// nothing is banked. The agents have to qualify a prospective collection: can
// they actually enroll for our criteria, on what protocol, at what cost, and
// what's the IP/data structure.
const PROSPECTIVE_ITEMS: AuditItemDef[] = [
  {
    id: "feasibility",
    title: "Feasibility for our population",
    detail: "Confirm the partner can recruit donors that match our indication, stage, and inclusion criteria.",
  },
  {
    id: "recruitment_timeline",
    title: "Recruitment timeline",
    detail: "Months to first donor + months to N — at our requested cohort size.",
  },
  {
    id: "protocol",
    title: "Prospective protocol design",
    detail: "Specimen types, time points, processing SOP, central vs local lab handling.",
  },
  {
    id: "consent",
    title: "Consent + IRB plan",
    detail: "New protocol vs amendment to an existing IRB; commercial-use scope; data-sharing terms.",
  },
  {
    id: "pricing",
    title: "Pricing model",
    detail: "Per-enrollment, per-visit, per-specimen; setup fee; minimum commitment.",
  },
  {
    id: "ip_data",
    title: "IP + data terms",
    detail: "Sample ownership, data-rights, co-publication scope, exclusivity windows.",
  },
];

const BUNDLE_NEGOTIATION_ITEMS: AuditItemDef[] = [
  {
    id: "n_price",
    title: "Price negotiation",
    detail: "Counter the opening quotes per leg; benchmark against comparable bundles.",
  },
  {
    id: "n_timeline",
    title: "Timeline alignment",
    detail: "Sequence retrieval and assay slots so samples don't sit between legs.",
  },
  {
    id: "n_volume",
    title: "Volume commitment",
    detail: "Trade larger commit for unit-price improvement where it makes sense.",
  },
  {
    id: "n_contract",
    title: "Contract structure",
    detail: "One MSA + work orders vs separate per-leg contracts; payment terms.",
  },
];

type AuditState = {
  selected: Record<string, boolean>;
  custom: string;
};

function defaultAuditState(): AuditState {
  const selected: Record<string, boolean> = {};
  for (const item of AUDIT_ITEMS) selected[item.id] = true;
  return { selected, custom: "" };
}

function defaultBundleAuditState(): AuditState {
  const selected: Record<string, boolean> = {};
  for (const item of [...BUNDLE_INSTITUTE_ITEMS, ...BUNDLE_PROVIDER_ITEMS, ...BUNDLE_NEGOTIATION_ITEMS]) {
    selected[item.id] = true;
  }
  return { selected, custom: "" };
}

const UNIT = {
  voice: 1.83, // ~6 min × $0.30/min
  email: 0.5, // 3-touch sequence
  parsing: 0.25,
  booking: 0.17, // amortized over expected qualified subset
} as const;

type Estimate = {
  voice: number;
  email: number;
  parsing: number;
  booking: number;
  total: number;
};

function estimateFor(n: number): Estimate {
  const safe = Math.max(1, n);
  const voice = +(safe * UNIT.voice).toFixed(2);
  const email = +(safe * UNIT.email).toFixed(2);
  const parsing = +(safe * UNIT.parsing).toFixed(2);
  const booking = +(safe * UNIT.booking).toFixed(2);
  return { voice, email, parsing, booking, total: +(voice + email + parsing + booking).toFixed(2) };
}

// Bundle is two-sided: institutes AND assay providers each get outreach,
// plus a cross-leg negotiation round once quotes come in.
type BundleEstimate = {
  instituteOutreach: number;   // voice + email per institute
  providerOutreach: number;    // voice + email per assay provider
  negotiation: number;         // cross-leg negotiation rounds (price + timeline)
  parsing: number;
  booking: number;
  total: number;
};

const NEGOTIATION_PER_LEG = 0.85; // model + agent time per negotiation round per leg

function estimateForBundle(institutes: number, providers: number): BundleEstimate {
  const i = Math.max(0, institutes);
  const p = Math.max(0, providers);
  const total_legs = i + p;
  const safe_legs = Math.max(1, total_legs);
  const instituteOutreach = +(i * (UNIT.voice + UNIT.email)).toFixed(2);
  const providerOutreach = +(p * (UNIT.voice + UNIT.email)).toFixed(2);
  // Negotiation only kicks in when there are legs to negotiate against each other
  const negotiation = +(safe_legs * NEGOTIATION_PER_LEG).toFixed(2);
  const parsing = +(safe_legs * UNIT.parsing).toFixed(2);
  const booking = +(safe_legs * UNIT.booking).toFixed(2);
  return {
    instituteOutreach,
    providerOutreach,
    negotiation,
    parsing,
    booking,
    total: +(instituteOutreach + providerOutreach + negotiation + parsing + booking).toFixed(2),
  };
}

function suggestCap(estimateTotal: number): { min: number; max: number; def: number } {
  const ceil5 = (v: number) => Math.max(5, Math.ceil(v / 5) * 5);
  const ceil10 = (v: number) => Math.max(10, Math.ceil(v / 10) * 10);
  const min = Math.max(25, ceil5(estimateTotal * 1.05));
  const def = Math.max(min, ceil5(estimateTotal * 1.5));
  const max = Math.max(def + 50, ceil10(estimateTotal * 3));
  return { min, max, def };
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtCap(n: number): string {
  return `$${Math.round(n)}`;
}

type Props = {
  open: boolean;
  onClose: () => void;
  rawQuery: string;
  parsed: ParseResult | null;
  result: QuerySpecimensResult | null;
  bundle?: Bundle | null;
  prospective?: ProspectiveCard | null;
  bankedInstitute?: InstituteEntry | null;
};

type Card = {
  number: string;
  exp: string;
  cvc: string;
  zip: string;
};

type CampaignAuth = {
  cap: number;
  pauseAt80: boolean;
  card: Card;
};

// Logged-in user assumption — the modal no longer collects identity.
const SIGNED_IN_USER = { name: "Kamil", email: "kamil.seg@gmail.com" };

function outreachCount(
  result: QuerySpecimensResult | null,
  bundle?: Bundle | null,
  bankedInstitute?: InstituteEntry | null,
  prospective?: ProspectiveCard | null,
): number {
  if (bundle) return bundle.samples.totals.institutes;
  if (bankedInstitute) return 1;
  if (prospective) return 1;
  return result?.totals.institutes ?? 0;
}

export function HandoffModal({ open, onClose, rawQuery, parsed, result, bundle, prospective, bankedInstitute }: Props) {
  const isAudit = !!bankedInstitute;
  const isBundle = !!bundle && !isAudit;
  const isProspective = !!prospective && !isAudit && !isBundle;
  const initialStep: Step =
    isAudit ? "audit" : isBundle ? "bundle" : isProspective ? "prospective" : "prompt";

  const [step, setStep] = useState<Step>(initialStep);
  const [prompt, setPrompt] = useState<string>(() => composePrompt(rawQuery, parsed, result, bundle, prospective, bankedInstitute));
  const [audit, setAudit] = useState<AuditState>(() => defaultAuditState());
  const [bundleAudit, setBundleAudit] = useState<AuditState>(() => defaultBundleAuditState());
  const [submitting, setSubmitting] = useState(false);

  const n = outreachCount(result, bundle, bankedInstitute, prospective);
  const bundleEstimate = useMemo(
    () => (bundle ? estimateForBundle(bundle.samples.totals.institutes, bundle.assays.filter((a) => (a.selected ?? []).length > 0).length) : null),
    [bundle],
  );
  const estimate = useMemo(() => estimateFor(n), [n]);
  const totalForCap = bundleEstimate ? bundleEstimate.total : estimate.total;
  const capRange = useMemo(() => suggestCap(totalForCap), [totalForCap]);
  const [campaign, setCampaign] = useState<CampaignAuth>(() => ({
    cap: capRange.def,
    pauseAt80: true,
    card: { number: "", exp: "", cvc: "", zip: "" },
  }));

  const [prospectiveCustom, setProspectiveCustom] = useState<string>("");
  const [runId, setRunId] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedActionPreview[]>([]);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  // Reset state when reopening with new context
  useEffect(() => {
    if (open) {
      setPrompt(composePrompt(rawQuery, parsed, result, bundle, prospective, bankedInstitute));
      setAudit(defaultAuditState());
      setBundleAudit(defaultBundleAuditState());
      setProspectiveCustom("");
      setStep(isAudit ? "audit" : isBundle ? "bundle" : isProspective ? "prospective" : "prompt");
      setCampaign((c) => ({ ...c, cap: capRange.def, card: { number: "", exp: "", cvc: "", zip: "" } }));
    }
  }, [open, rawQuery, parsed, result, bundle, prospective, bankedInstitute, capRange.def, isAudit, isBundle, isProspective]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canContinuePrompt = prompt.trim().length > 10;
  const canContinueAudit = Object.values(audit.selected).some(Boolean) || audit.custom.trim().length > 0;
  const canContinueBundle = true; // standard playbook applied; custom is optional
  const canAuthorize =
    /^\d{12,19}$/.test(campaign.card.number.replace(/\s/g, "")) &&
    /^\d{2}\s*\/\s*\d{2}$/.test(campaign.card.exp) &&
    /^\d{3,4}$/.test(campaign.card.cvc) &&
    /^\d{4,5}$/.test(campaign.card.zip) &&
    campaign.cap >= capRange.min;

  async function authorize() {
    setSubmitting(true);
    setDispatchError(null);
    try {
      const filters = parsed?.filters ?? {};
      const { runId: id } = await startRun({ raw_query: rawQuery || prompt, parsed_filters: filters });
      setRunId(id);
      const suppliers = await listSuppliers();
      // Skip the crovi.bio meta sentinel — it's a discovery layer, not a real outbound target.
      const targets = suppliers.filter((s) => s.meta_flag !== "discovery_layer");
      const previews = await stageAll(id, targets);
      setStaged(previews);
      setStep("dispatch");
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm(idx: number) {
    if (!runId) return;
    const action = staged[idx];
    if (!action || action.status !== "staged") return;
    setStaged((prev) => prev.map((p, i) => (i === idx ? { ...p, status: "sending" } : p)));
    const out = await confirmOne(runId, action);
    setStaged((prev) =>
      prev.map((p, i) =>
        i === idx
          ? out.ok
            ? { ...p, status: "sent", result: { target: p.preview.target, ref: out.ref ?? "" } }
            : { ...p, status: "failed", error: out.error }
          : p,
      ),
    );
  }

  async function handleConfirmAll() {
    const queued = staged.map((s, i) => (s.status === "staged" ? i : -1)).filter((i) => i >= 0);
    await Promise.all(queued.map((i) => handleConfirm(i)));
  }

  return (
    <div className="hf-scrim" onClick={onClose}>
      <div
        className="hf-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="hf-close" onClick={onClose} aria-label="Close">×</button>

        <Stepper current={step} mode={isAudit ? "audit" : isBundle ? "bundle" : isProspective ? "prospective" : "prompt"} />

        {step === "prompt" && (
          <StepPrompt
            value={prompt}
            onChange={setPrompt}
            onContinue={() => setStep("campaign")}
            canContinue={canContinuePrompt}
          />
        )}

        {step === "audit" && bankedInstitute && (
          <StepAudit
            institute={bankedInstitute}
            audit={audit}
            onChange={setAudit}
            onContinue={() => setStep("campaign")}
            canContinue={canContinueAudit}
          />
        )}

        {step === "bundle" && bundle && (
          <StepBundleAudit
            bundle={bundle}
            audit={bundleAudit}
            onChange={setBundleAudit}
            onContinue={() => setStep("campaign")}
            canContinue={canContinueBundle}
          />
        )}

        {step === "prospective" && prospective && (
          <StepProspective
            card={prospective}
            rawQuery={rawQuery}
            parsed={parsed}
            custom={prospectiveCustom}
            onCustomChange={setProspectiveCustom}
            onContinue={() => setStep("campaign")}
          />
        )}

        {step === "campaign" && isBundle && bundle && bundleEstimate && (
          <StepBundleCampaign
            bundle={bundle}
            estimate={bundleEstimate}
            campaign={campaign}
            capRange={capRange}
            onChange={setCampaign}
            onBack={() => setStep("bundle")}
            onAuthorize={authorize}
            canAuthorize={canAuthorize}
            submitting={submitting}
          />
        )}

        {step === "campaign" && !isBundle && (
          <StepCampaign
            n={n}
            estimate={estimate}
            campaign={campaign}
            capRange={capRange}
            onChange={setCampaign}
            onBack={() => setStep(isAudit ? "audit" : isProspective ? "prospective" : "prompt")}
            onAuthorize={authorize}
            canAuthorize={canAuthorize}
            submitting={submitting}
          />
        )}

        {step === "dispatch" && (
          <StepDispatch
            result={result}
            campaign={campaign}
            n={n}
            mode={isAudit ? "audit" : isBundle ? "bundle" : isProspective ? "prospective" : "prompt"}
            institute={bankedInstitute ?? null}
            bundle={bundle ?? null}
            prospective={prospective ?? null}
            onClose={onClose}
            runId={runId}
            staged={staged}
            onConfirm={handleConfirm}
            onConfirmAll={handleConfirmAll}
            dispatchError={dispatchError}
          />
        )}
      </div>
    </div>
  );
}

function Stepper({ current, mode }: { current: Step; mode: "audit" | "bundle" | "prospective" | "prompt" }) {
  const steps: { id: Step; label: string }[] =
    mode === "audit"
      ? [
          { id: "audit", label: "AUDIT SCOPE" },
          { id: "campaign", label: "AUTHORIZE" },
          { id: "dispatch", label: "DISPATCH" },
        ]
      : mode === "bundle"
        ? [
            { id: "bundle", label: "AUDIT + NEGOTIATE" },
            { id: "campaign", label: "AUTHORIZE" },
            { id: "dispatch", label: "DISPATCH" },
          ]
        : mode === "prospective"
          ? [
              { id: "prospective", label: "QUALIFY LEAD" },
              { id: "campaign", label: "AUTHORIZE" },
              { id: "dispatch", label: "DISPATCH" },
            ]
          : [
              { id: "prompt", label: "BRIEF" },
              { id: "campaign", label: "AUTHORIZE" },
              { id: "dispatch", label: "DISPATCH" },
            ];
  const idx = steps.findIndex((s) => s.id === current);
  return (
    <ol className="hf-stepper">
      {steps.map((s, i) => {
        const state = i < idx ? "done" : i === idx ? "active" : "pending";
        return (
          <li key={s.id} className={`hf-step ${state}`}>
            <span className="hf-step-num">{i + 1}</span>
            <span className="hf-step-label mono">{s.label}</span>
            {i < steps.length - 1 && <span className="hf-step-sep">—</span>}
          </li>
        );
      })}
    </ol>
  );
}

function StepPrompt({
  value,
  onChange,
  onContinue,
  canContinue,
}: {
  value: string;
  onChange: (v: string) => void;
  onContinue: () => void;
  canContinue: boolean;
}) {
  return (
    <div className="hf-step-body">
      <h2 className="hf-h serif">
        Describe the dataset <em>in your own words.</em>
      </h2>
      <p className="hf-sub">
        Requirements, sample counts, assays, inclusion criteria, budget, timeline. Crovi's agents
        will parse it, enrich it, and source it on your behalf.
      </p>
      <textarea
        className="hf-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
      />
      <div className="hf-actions">
        <button className="hf-btn-primary" disabled={!canContinue} onClick={onContinue}>
          Continue <span className="hf-arrow">→</span>
        </button>
      </div>
    </div>
  );
}

function StepAudit({
  institute,
  audit,
  onChange,
  onContinue,
  canContinue,
}: {
  institute: InstituteEntry;
  audit: AuditState;
  onChange: (a: AuditState) => void;
  onContinue: () => void;
  canContinue: boolean;
}) {
  function toggle(id: string) {
    onChange({ ...audit, selected: { ...audit.selected, [id]: !audit.selected[id] } });
  }
  function setCustom(v: string) {
    onChange({ ...audit, custom: v });
  }

  return (
    <div className="hf-step-body">
      <h2 className="hf-h serif">
        Audit <em>{institute.name}.</em>
      </h2>
      <p className="hf-sub">
        You already have the institute on file. The agents go back to the steward and verify the
        items below before any specimen moves — toggle off anything you don't need.
      </p>

      <ul className="hf-audit-list">
        {AUDIT_ITEMS.map((item) => {
          const on = !!audit.selected[item.id];
          return (
            <li
              key={item.id}
              className={`hf-audit-item ${on ? "on" : ""}`}
              onClick={() => toggle(item.id)}
            >
              <span className="hf-audit-check" aria-hidden>{on ? "✓" : ""}</span>
              <div className="hf-audit-text">
                <div className="hf-audit-h">{item.title}</div>
                <div className="hf-audit-sub">{item.detail}</div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="hf-audit-custom">
        <label className="hf-label mono" htmlFor="hf-audit-custom-input">Anything else to verify (optional)</label>
        <textarea
          id="hf-audit-custom-input"
          className="hf-textarea"
          rows={3}
          placeholder={`e.g. confirm Brown lab's MS IIT residuals can be released; ask about pediatric subset; flag the 2014 IRB amendment.`}
          value={audit.custom}
          onChange={(e) => setCustom(e.target.value)}
        />
      </div>

      <div className="hf-actions">
        <button className="hf-btn-primary" disabled={!canContinue} onClick={onContinue}>
          Continue <span className="hf-arrow">→</span>
        </button>
      </div>
    </div>
  );
}

function StepProspective({
  card,
  rawQuery,
  parsed,
  custom,
  onCustomChange,
  onContinue,
}: {
  card: ProspectiveCard;
  rawQuery: string;
  parsed: ParseResult | null;
  custom: string;
  onCustomChange: (v: string) => void;
  onContinue: () => void;
}) {
  const stated = parsed?.fields.filter((f) => f.source === "stated").map((f) => `${f.label}: ${f.value}`) ?? [];
  return (
    <div className="hf-step-body">
      <h2 className="hf-h serif">
        Qualify <em>{card.institution}</em> for prospective collection.
      </h2>
      <p className="hf-sub">
        The partner has the population and the prior activity. Agents forward your original
        request and pursue the prospective-specific questions below — feasibility for our
        criteria, recruitment timeline, protocol design, and commercial terms.
      </p>

      <div className="hf-prosp-context">
        <div className="hf-prosp-row">
          <span className="hf-prosp-k mono">Original request</span>
          <span className="hf-prosp-v">{rawQuery || "—"}</span>
        </div>
        {stated.length > 0 && (
          <div className="hf-prosp-row">
            <span className="hf-prosp-k mono">Captured filters</span>
            <span className="hf-prosp-v">{stated.join(" · ")}</span>
          </div>
        )}
        {card.matched && (
          <div className="hf-prosp-row">
            <span className="hf-prosp-k mono">Why this lead</span>
            <span className="hf-prosp-v">
              <span className="hf-prosp-area">{card.matched.area}</span>
              <span> — {card.matched.fact}</span>
            </span>
          </div>
        )}
        <div className="hf-prosp-row">
          <span className="hf-prosp-k mono">Access path</span>
          <span className="hf-prosp-v">{stripMd(card.layer1.accessPath) || "—"}</span>
        </div>
      </div>

      <BundleAskList eyebrow="Agents will pursue" items={PROSPECTIVE_ITEMS} />

      <div className="hf-audit-custom">
        <label className="hf-label mono" htmlFor="hf-prosp-custom">Anything specific (optional)</label>
        <textarea
          id="hf-prosp-custom"
          className="hf-textarea"
          rows={3}
          placeholder="e.g. need ≥ 100 enrollments by Q3; must include CSF; willing to fund a protocol amendment if it accelerates timeline."
          value={custom}
          onChange={(e) => onCustomChange(e.target.value)}
        />
      </div>

      <div className="hf-actions">
        <button className="hf-btn-primary" onClick={onContinue}>
          Continue <span className="hf-arrow">→</span>
        </button>
      </div>
    </div>
  );
}

function StepBundleAudit({
  bundle,
  audit,
  onChange,
  onContinue,
  canContinue,
}: {
  bundle: Bundle;
  audit: AuditState;
  onChange: (a: AuditState) => void;
  onContinue: () => void;
  canContinue: boolean;
}) {
  const instCount = bundle.samples.totals.institutes;
  const providerCount = bundle.assays.filter((a) => (a.selected ?? []).length > 0).length;

  return (
    <div className="hf-step-body">
      <h2 className="hf-h serif">
        Audit + negotiate <em>this bundle.</em>
      </h2>
      <p className="hf-sub">
        Standard playbook for each leg — agents verify, negotiate, and reconcile before any
        contract goes out. Add anything specific at the bottom.
      </p>

      <BundleAskList
        eyebrow={`Each of the ${instCount} institute${instCount === 1 ? "" : "s"}`}
        items={BUNDLE_INSTITUTE_ITEMS}
      />
      <BundleAskList
        eyebrow={`Each of the ${providerCount} assay provider${providerCount === 1 ? "" : "s"}`}
        items={BUNDLE_PROVIDER_ITEMS}
      />
      <BundleAskList
        eyebrow="Across the legs"
        items={BUNDLE_NEGOTIATION_ITEMS}
      />

      <div className="hf-audit-custom">
        <label className="hf-label mono" htmlFor="hf-bundle-custom">Anything specific (optional)</label>
        <textarea
          id="hf-bundle-custom"
          className="hf-textarea"
          rows={3}
          placeholder="e.g. cap total spend per leg at $X; EU-only sample handling; prioritize Provider B if turnaround beats 4 weeks."
          value={audit.custom}
          onChange={(e) => onChange({ ...audit, custom: e.target.value })}
        />
      </div>

      <div className="hf-actions">
        <button className="hf-btn-primary" disabled={!canContinue} onClick={onContinue}>
          Continue <span className="hf-arrow">→</span>
        </button>
      </div>
    </div>
  );
}

function BundleAskList({ eyebrow, items }: { eyebrow: string; items: AuditItemDef[] }) {
  return (
    <div className="hf-ask">
      <div className="hf-ask-eyebrow mono">{eyebrow}</div>
      <ul className="hf-ask-list">
        {items.map((item) => (
          <li key={item.id} className="hf-ask-item">{item.title}</li>
        ))}
      </ul>
    </div>
  );
}

function StepCampaign({
  n,
  estimate,
  campaign,
  capRange,
  onChange,
  onBack,
  onAuthorize,
  canAuthorize,
  submitting,
}: {
  n: number;
  estimate: Estimate;
  campaign: CampaignAuth;
  capRange: { min: number; max: number; def: number };
  onChange: (c: CampaignAuth) => void;
  onBack: () => void;
  onAuthorize: () => void;
  canAuthorize: boolean;
  submitting: boolean;
}) {
  const low = Math.round(estimate.total * 0.7);
  const high = Math.round(estimate.total * 1.5);
  const target = n === 1 ? "1 biobank" : `${n} biobanks`;
  const setCard = (patch: Partial<Card>) => onChange({ ...campaign, card: { ...campaign.card, ...patch } });

  return (
    <div className="hf-step-body">
      <h2 className="hf-h serif">
        Authorize outreach for <em>{target}.</em>
      </h2>
      <p className="hf-sub">
        Voice and email run on metered infrastructure (Twilio minutes, voice model tokens, inbox
        parsing). The line items below are an estimate — your <strong>budget cap</strong> is the
        actual ceiling. Outreach pauses automatically when you hit the threshold.
      </p>

      <div className="hf-cost-card">
        <div className="hf-cost-head">
          <span className="hf-cost-lbl mono">Estimated campaign · {target}</span>
          <span className="hf-cost-range mono">typical {fmtCap(low)}–{fmtCap(high)}</span>
        </div>
        <ul className="hf-cost-rows">
          <CostRow
            label="Voice intros"
            sub={`${n} × ~6 min @ $0.30/min`}
            value={estimate.voice}
          />
          <CostRow
            label="Email sequences"
            sub={`3-touch × ${n}`}
            value={estimate.email}
          />
          <CostRow
            label="Response parsing"
            sub="qualify and route inbound"
            value={estimate.parsing}
          />
          <CostRow
            label="Calendar booking"
            sub="qualified subset only"
            value={estimate.booking}
          />
        </ul>
        <div className="hf-cost-total">
          <span className="hf-cost-total-lbl mono">Estimated total</span>
          <span className="hf-cost-total-val">{fmtMoney(estimate.total)}</span>
        </div>
      </div>

      <div className="hf-cap-block">
        <div className="hf-cap-head">
          <label className="hf-label mono" htmlFor="hf-cap">Campaign budget cap</label>
          <span className="hf-cap-val">{fmtCap(campaign.cap)}</span>
        </div>
        <input
          id="hf-cap"
          type="range"
          className="hf-slider"
          min={capRange.min}
          max={capRange.max}
          step={5}
          value={campaign.cap}
          onChange={(e) => onChange({ ...campaign, cap: Number(e.target.value) })}
        />
        <div className="hf-cap-scale mono">
          <span>{fmtCap(capRange.min)}</span>
          <span>{fmtCap(capRange.max)}</span>
        </div>
        <label className="hf-cap-pause">
          <input
            type="checkbox"
            checked={campaign.pauseAt80}
            onChange={(e) => onChange({ ...campaign, pauseAt80: e.target.checked })}
          />
          <span>
            Pause when budget hits <strong>80%</strong> ({fmtCap(campaign.cap * 0.8)}) — confirm before
            burning the rest.
          </span>
        </label>
      </div>

      <div className="hf-card-block">
        <div className="hf-label mono">Payment</div>
        <StripeCardElementMock card={campaign.card} setCard={setCard} />
        <div className="hf-card-note mono">
          Demo only — no card is charged. Stripe Elements drop-in (mock) — production swaps to a
          real PaymentElement with the same layout.
        </div>
      </div>

      <div className="hf-actions">
        <button className="hf-btn-secondary" onClick={onBack} disabled={submitting}>
          ← Back
        </button>
        <button
          className="hf-btn-primary"
          disabled={!canAuthorize || submitting}
          onClick={onAuthorize}
        >
          {submitting ? "Authorizing…" : `Authorize ${fmtCap(campaign.cap)} budget`}{" "}
          <span className="hf-arrow">→</span>
        </button>
      </div>
    </div>
  );
}

function StepBundleCampaign({
  bundle,
  estimate,
  campaign,
  capRange,
  onChange,
  onBack,
  onAuthorize,
  canAuthorize,
  submitting,
}: {
  bundle: Bundle;
  estimate: BundleEstimate;
  campaign: CampaignAuth;
  capRange: { min: number; max: number; def: number };
  onChange: (c: CampaignAuth) => void;
  onBack: () => void;
  onAuthorize: () => void;
  canAuthorize: boolean;
  submitting: boolean;
}) {
  const instCount = bundle.samples.totals.institutes;
  const provCount = bundle.assays.filter((a) => (a.selected ?? []).length > 0).length;
  const totalLegs = instCount + provCount;
  const low = Math.round(estimate.total * 0.7);
  const high = Math.round(estimate.total * 1.5);
  const setCard = (patch: Partial<Card>) => onChange({ ...campaign, card: { ...campaign.card, ...patch } });

  const target = `${instCount} institute${instCount === 1 ? "" : "s"} + ${provCount} assay provider${provCount === 1 ? "" : "s"}`;

  return (
    <div className="hf-step-body">
      <h2 className="hf-h serif">
        Authorize <em>{target}.</em>
      </h2>
      <p className="hf-sub">
        Two-sided bundle — agents run outreach on each leg, then negotiate price and timeline
        across them. Line items are an estimate; your <strong>budget cap</strong> is the actual
        ceiling.
      </p>

      <div className="hf-cost-card">
        <div className="hf-cost-head">
          <span className="hf-cost-lbl mono">Estimated bundle · {target}</span>
          <span className="hf-cost-range mono">typical {fmtCap(low)}–{fmtCap(high)}</span>
        </div>
        <ul className="hf-cost-rows">
          <CostRow
            label="Institute outreach"
            sub={`${instCount} × voice + 3-touch email`}
            value={estimate.instituteOutreach}
          />
          <CostRow
            label="Assay provider outreach"
            sub={`${provCount} × voice + 3-touch email`}
            value={estimate.providerOutreach}
          />
          <CostRow
            label="Cross-leg negotiation"
            sub="price + timeline rounds across legs"
            value={estimate.negotiation}
          />
          <CostRow
            label="Response parsing"
            sub="qualify and route inbound"
            value={estimate.parsing}
          />
          <CostRow
            label="Calendar booking"
            sub="qualified subset only"
            value={estimate.booking}
          />
        </ul>
        <div className="hf-cost-total">
          <span className="hf-cost-total-lbl mono">Estimated total · {totalLegs} leg{totalLegs === 1 ? "" : "s"}</span>
          <span className="hf-cost-total-val">{fmtMoney(estimate.total)}</span>
        </div>
      </div>

      <div className="hf-cap-block">
        <div className="hf-cap-head">
          <label className="hf-label mono" htmlFor="hf-bcap">Bundle budget cap</label>
          <span className="hf-cap-val">{fmtCap(campaign.cap)}</span>
        </div>
        <input
          id="hf-bcap"
          type="range"
          className="hf-slider"
          min={capRange.min}
          max={capRange.max}
          step={5}
          value={campaign.cap}
          onChange={(e) => onChange({ ...campaign, cap: Number(e.target.value) })}
        />
        <div className="hf-cap-scale mono">
          <span>{fmtCap(capRange.min)}</span>
          <span>{fmtCap(capRange.max)}</span>
        </div>
        <label className="hf-cap-pause">
          <input
            type="checkbox"
            checked={campaign.pauseAt80}
            onChange={(e) => onChange({ ...campaign, pauseAt80: e.target.checked })}
          />
          <span>
            Pause when budget hits <strong>80%</strong> ({fmtCap(campaign.cap * 0.8)}) — confirm before
            burning the rest.
          </span>
        </label>
      </div>

      <div className="hf-card-block">
        <div className="hf-label mono">Payment</div>
        <StripeCardElementMock card={campaign.card} setCard={setCard} />
        <div className="hf-card-note mono">
          Demo only — no card is charged. Stripe Elements drop-in (mock) — production swaps to a
          real PaymentElement with the same layout.
        </div>
      </div>

      <div className="hf-actions">
        <button className="hf-btn-secondary" onClick={onBack} disabled={submitting}>
          ← Back
        </button>
        <button
          className="hf-btn-primary"
          disabled={!canAuthorize || submitting}
          onClick={onAuthorize}
        >
          {submitting ? "Authorizing…" : `Authorize ${fmtCap(campaign.cap)} budget`}{" "}
          <span className="hf-arrow">→</span>
        </button>
      </div>
    </div>
  );
}

function CostRow({ label, sub, value }: { label: string; sub: string; value: number }) {
  return (
    <li className="hf-cost-row">
      <div className="hf-cost-row-l">
        <div className="hf-cost-row-lbl">{label}</div>
        <div className="hf-cost-row-sub mono">{sub}</div>
      </div>
      <div className="hf-cost-row-val">{fmtMoney(value)}</div>
    </li>
  );
}

// Visual copy of Stripe's CardElement: single bordered row with brand icon,
// formatted number, expiry, CVC, and postal in one field. Production swaps to
// @stripe/react-stripe-js <PaymentElement> with a publishable key.
function StripeCardElementMock({
  card,
  setCard,
}: {
  card: Card;
  setCard: (patch: Partial<Card>) => void;
}) {
  const [focused, setFocused] = useState(false);
  const brand = detectBrand(card.number);

  function onNumberChange(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 19);
    const groups = digits.match(/.{1,4}/g) ?? [];
    setCard({ number: groups.join(" ") });
  }
  function onExpChange(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 4);
    const formatted = digits.length > 2 ? `${digits.slice(0, 2)} / ${digits.slice(2)}` : digits;
    setCard({ exp: formatted });
  }
  function onCvcChange(v: string) {
    setCard({ cvc: v.replace(/\D/g, "").slice(0, 4) });
  }
  function onZipChange(v: string) {
    setCard({ zip: v.replace(/\D/g, "").slice(0, 5) });
  }

  return (
    <div className={`stripe-card ${focused ? "focused" : ""}`}>
      <span className={`stripe-brand brand-${brand}`} aria-hidden>
        {brand === "visa" ? "VISA" : brand === "amex" ? "AMEX" : brand === "mastercard" ? "MC" : "▭"}
      </span>
      <input
        className="stripe-field stripe-number"
        inputMode="numeric"
        autoComplete="cc-number"
        placeholder="1234 1234 1234 1234"
        value={card.number}
        onChange={(e) => onNumberChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <input
        className="stripe-field stripe-exp"
        inputMode="numeric"
        autoComplete="cc-exp"
        placeholder="MM / YY"
        value={card.exp}
        onChange={(e) => onExpChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <input
        className="stripe-field stripe-cvc"
        inputMode="numeric"
        autoComplete="cc-csc"
        placeholder="CVC"
        value={card.cvc}
        onChange={(e) => onCvcChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <input
        className="stripe-field stripe-zip"
        inputMode="numeric"
        autoComplete="postal-code"
        placeholder="ZIP"
        value={card.zip}
        onChange={(e) => onZipChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </div>
  );
}

function detectBrand(num: string): "visa" | "mastercard" | "amex" | "unknown" {
  const d = num.replace(/\D/g, "");
  if (/^4/.test(d)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(d)) return "mastercard";
  if (/^3[47]/.test(d)) return "amex";
  return "unknown";
}

function StepDispatch({
  result,
  campaign,
  n,
  mode,
  institute,
  bundle,
  prospective,
  onClose,
  runId,
  staged,
  onConfirm,
  onConfirmAll,
  dispatchError,
}: {
  result: QuerySpecimensResult | null;
  campaign: CampaignAuth;
  n: number;
  mode: "audit" | "bundle" | "prospective" | "prompt";
  institute: InstituteEntry | null;
  bundle: Bundle | null;
  prospective: ProspectiveCard | null;
  onClose: () => void;
  runId: string | null;
  staged: StagedActionPreview[];
  onConfirm: (idx: number) => void;
  onConfirmAll: () => void;
  dispatchError: string | null;
}) {
  const first = SIGNED_IN_USER.name.split(" ")[0] || "there";
  const instituteCount = n > 0 ? n : result?.totals.institutes ?? 0;
  const withContact = result?.institutes.filter((i) => !!i.contact_email).length ?? 0;
  const target =
    mode === "audit" && institute
      ? institute.name
      : mode === "bundle" && bundle
        ? `${bundle.samples.totals.institutes} institute${bundle.samples.totals.institutes === 1 ? "" : "s"} + ${bundle.assays.length} assay leg${bundle.assays.length === 1 ? "" : "s"}`
        : mode === "prospective" && prospective
          ? prospective.institution
          : instituteCount > 0
            ? `${instituteCount} candidate institute${instituteCount === 1 ? "" : "s"}`
            : "the matched institutes";

  const headline =
    mode === "audit" ? "Audit launched"
      : mode === "bundle" ? "Bundle agent launched"
      : mode === "prospective" ? "Prospective lead qualified"
      : "Campaign authorized";
  const lead =
    mode === "audit" ? "Audit on "
      : mode === "bundle" ? "Bundle audit + negotiation across "
      : mode === "prospective" ? "Prospective qualification with "
      : "Outreach to ";
  const followup =
    mode === "audit" ? "checklist results as the steward responds"
      : mode === "bundle" ? "per-leg quotes and negotiation status as agents work each side"
      : mode === "prospective" ? "feasibility, timeline, protocol, and pricing as the partner replies"
      : "a per-biobank breakdown as replies come in";

  return (
    <div className="hf-step-body hf-confirm">
      <div className="hf-tick">✓</div>
      <h2 className="hf-h serif">
        {headline}, <em>{first}.</em>
      </h2>
      <p className="hf-sub">
        {lead}{target} starts now, capped at <strong>{fmtCap(campaign.cap)}</strong>
        {campaign.pauseAt80 ? <> with auto-pause at <strong>{fmtCap(campaign.cap * 0.8)}</strong></> : null}.
        Spend updates land in your inbox at{" "}
        <span className="hf-email">{SIGNED_IN_USER.email}</span>, with {followup}.
      </p>
      <ol className="hf-next">
        <li>
          <span className="hf-next-num mono">01</span>
          <div>
            <div className="hf-next-h">Outreach kicks off</div>
            <div className="hf-next-sub">
              Agents reach the{" "}
              {withContact > 0
                ? `${withContact} institute${withContact === 1 ? "" : "s"} with verified contacts`
                : "matched institutes"}{" "}
              first — voice intro then 3-touch email sequence
            </div>
          </div>
        </li>
        <li>
          <span className="hf-next-num mono">02</span>
          <div>
            <div className="hf-next-h">Burn-down meter</div>
            <div className="hf-next-sub">
              Live spend on the dashboard. {campaign.pauseAt80 ? "Auto-pause at 80% — top up or close out." : "No auto-pause; outreach runs to the cap."}
            </div>
          </div>
        </li>
        <li>
          <span className="hf-next-num mono">03</span>
          <div>
            <div className="hf-next-h">Reply inbox</div>
            <div className="hf-next-sub">
              Qualified responses get a calendar booking; the rest land in your queue with parsed context.
            </div>
          </div>
        </li>
      </ol>
      <div className="hf-meta-grid">
        <Meta k="Budget cap" v={fmtCap(campaign.cap)} />
        <Meta
          k="Outreach"
          v={instituteCount > 0 ? `${instituteCount} institute${instituteCount === 1 ? "" : "s"}` : "Queued"}
        />
        <Meta k="Pause at 80%" v={campaign.pauseAt80 ? "On" : "Off"} />
      </div>

      {dispatchError && (
        <div className="hf-dispatch-error">
          <strong>Dispatch error:</strong> {dispatchError}
        </div>
      )}

      {staged.length > 0 && (
        <div className="hf-staged">
          <div className="hf-staged-h">
            <span className="mono">{staged.length}</span> action{staged.length === 1 ? "" : "s"} staged · run <span className="mono">{runId}</span>
          </div>
          <ul className="hf-staged-list">
            {staged.map((s, i) => (
              <li key={`${s.supplier_id}:${s.channel}:${i}`} className={`hf-staged-row hf-status-${s.status}`}>
                <div className="hf-staged-meta">
                  <span className={`hf-staged-channel hf-channel-${s.channel}`}>{s.channel === "email" ? "✉" : "▢"} {s.channel}</span>
                  <span className="hf-staged-supplier">{s.supplier_name}</span>
                  <span className="hf-staged-target mono">{s.preview.target || "—"}</span>
                </div>
                <div className="hf-staged-headline">{s.preview.headline}</div>
                {s.preview.body && <pre className="hf-staged-body">{s.preview.body}</pre>}
                {s.reasoning && <div className="hf-staged-reasoning"><span className="mono">why:</span> {s.reasoning}</div>}
                {s.status === "staged" && (
                  <button className="hf-btn-primary hf-btn-small" onClick={() => onConfirm(i)}>
                    Confirm &amp; send
                  </button>
                )}
                {s.status === "sending" && <span className="hf-staged-status mono">sending…</span>}
                {s.status === "sent" && (
                  <span className="hf-staged-status mono">✓ sent · ref {s.result?.ref}</span>
                )}
                {s.status === "failed" && (
                  <span className="hf-staged-status hf-status-failed mono">✕ {s.error}</span>
                )}
              </li>
            ))}
          </ul>
          {staged.some((s) => s.status === "staged") && (
            <button className="hf-btn-primary" onClick={onConfirmAll}>
              Confirm all staged
            </button>
          )}
        </div>
      )}

      <div className="hf-actions">
        <button className="hf-btn-secondary" onClick={onClose}>
          Back to results
        </button>
      </div>
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="hf-meta">
      <div className="hf-meta-k mono">{k}</div>
      <div className="hf-meta-v">{v}</div>
    </div>
  );
}

function composePrompt(
  rawQuery: string,
  parsed: ParseResult | null,
  result: QuerySpecimensResult | null,
  bundle?: Bundle | null,
  prospective?: ProspectiveCard | null,
  bankedInstitute?: InstituteEntry | null,
): string {
  const lines: string[] = [];
  lines.push(rawQuery.trim() || "—");
  if (parsed) {
    const stated = parsed.fields.filter((f) => f.source === "stated").map((f) => `${f.label}: ${f.value}`);
    const inferred = parsed.fields.filter((f) => f.source === "inferred").map((f) => `${f.label}: ${f.value}`);
    if (stated.length || inferred.length) {
      lines.push("");
      lines.push("Filters captured during demo:");
      stated.forEach((s) => lines.push(`• ${s} (stated)`));
      inferred.forEach((s) => lines.push(`• ${s} (inferred — please confirm)`));
    }
  }

  if (bankedInstitute) {
    lines.push("");
    lines.push("Focus institute (selected for this brief):");
    lines.push(`• ${bankedInstitute.name}${bankedInstitute.country ? ` — ${bankedInstitute.country}` : ""}`);
    lines.push(
      `• ${bankedInstitute.sample_rows.length} matching` +
        (bankedInstitute.specimen_count > bankedInstitute.sample_rows.length
          ? ` of ${bankedInstitute.specimen_count.toLocaleString()} cataloged specimens`
          : " specimens") +
        ` · ${bankedInstitute.donor_count.toLocaleString()} donors` +
        (bankedInstitute.longitudinal_donor_count > 0
          ? ` · ${bankedInstitute.longitudinal_donor_count.toLocaleString()} longitudinal`
          : ""),
    );
    if (bankedInstitute.contact_email) {
      lines.push(`• Contact: ${bankedInstitute.contact_email}`);
    } else {
      lines.push(`• No public contact — agents will need to chase`);
    }
  }

  if (bundle) {
    lines.push("");
    lines.push("Bundle:");
    lines.push(
      `• Data: ${bundle.samples.totals.specimens.toLocaleString()} specimens across ` +
        `${bundle.samples.totals.institutes} institute${bundle.samples.totals.institutes === 1 ? "" : "s"}` +
        ` · ${bundle.samples.totals.donors.toLocaleString()} donors`,
    );
    for (const a of bundle.assays) {
      const picks = a.selected ?? [];
      if (picks.length === 0) {
        lines.push(`• ${a.assay} — agent will source provider`);
      } else if (picks.length === 1) {
        lines.push(`• ${a.assay} → ${picks[0].name} (${picks[0].country})`);
      } else {
        const named = picks.map((p) => `${p.name} (${p.country})`).join(", ");
        lines.push(`• ${a.assay} → any of: ${named}`);
      }
    }
  } else if (result && !bankedInstitute) {
    lines.push("");
    lines.push(
      `Demo run: ${result.totals.specimens.toLocaleString()} matching specimens across ${result.totals.institutes} institutes` +
        (result.totals.longitudinal_donors ? ` · ${result.totals.longitudinal_donors.toLocaleString()} longitudinal donors` : "")
    );
    if (result.institutes.length) {
      const top = result.institutes.slice(0, 3).map((i) => i.name).join(", ");
      lines.push(`Top matches: ${top}.`);
    }
  }

  if (prospective) {
    lines.push("");
    lines.push("Prospective collection partner (selected):");
    lines.push(`• ${prospective.institution} — ${prospective.location}`);
    if (prospective.matched) {
      lines.push(`• Match area: ${prospective.matched.area}`);
      lines.push(`• Signal: ${prospective.matched.fact}`);
    }
    lines.push(`• Program: ${stripMd(prospective.layer1.programName)}`);
    lines.push(`• Steward: ${stripMd(prospective.layer1.steward)}`);
    lines.push(`• Pool size: ${stripMd(prospective.layer1.poolSize)}`);
    lines.push(`• Access path: ${stripMd(prospective.layer1.accessPath)}`);
  }

  lines.push("");
  lines.push("(Edit anything above — the agent suite uses this as the starting brief.)");
  return lines.join("\n");
}

function stripMd(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}
