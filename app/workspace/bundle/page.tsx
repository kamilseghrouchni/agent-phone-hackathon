"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ParseResult } from "@/app/api/parse/types";
import type { QuerySpecimensResult, InstituteEntry } from "@/lib/tools/query_specimens";
import type { AssayChoice, Bundle, Provider } from "@/lib/bundle";
import { HandoffModal } from "@/components/Handoff/HandoffModal";
import { ProviderDrawer } from "@/components/Bundle/ProviderDrawer";

type StoredCtx = {
  rawQuery: string;
  parsed: ParseResult | null;
  result: QuerySpecimensResult | null;
};

export default function BundlePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<StoredCtx | null>(null);
  const [pickedInstitutes, setPickedInstitutes] = useState<Set<string>>(new Set());
  const [assayChoices, setAssayChoices] = useState<AssayChoice[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [drawerProvider, setDrawerProvider] = useState<{ provider: Provider; assay: string } | null>(null);

  // Read context dropped by the workspace page on navigation
  useEffect(() => {
    const raw = sessionStorage.getItem("crovi_bundle_ctx");
    if (!raw) {
      router.replace("/workspace");
      return;
    }
    try {
      const c = JSON.parse(raw) as StoredCtx;
      setCtx(c);
      if (c.result?.institutes) {
        setPickedInstitutes(new Set(c.result.institutes.map((i) => i.organization_id)));
      }
    } catch {
      router.replace("/workspace");
    }
  }, [router]);

  // Fetch providers for the parsed assays once ctx is loaded
  useEffect(() => {
    if (!ctx?.parsed?.assays?.length) {
      if (ctx) setLoading(false);
      return;
    }
    const list = ctx.parsed.assays.map((a) => a.assay).join(",");
    fetch(`/api/providers?assays=${encodeURIComponent(list)}`)
      .then((r) => r.json())
      .then((d) => setAssayChoices(d.assays))
      .finally(() => setLoading(false));
  }, [ctx]);

  const institutes = ctx?.result?.institutes ?? [];
  const selectedInstitutes = institutes.filter((i) => pickedInstitutes.has(i.organization_id));
  const totalSpecimens = selectedInstitutes.reduce((s, i) => s + (i.specimen_count ?? 0), 0);
  const totalDonors = selectedInstitutes.reduce((s, i) => s + (i.donor_count ?? 0), 0);

  // Multi-select per assay; zero providers is allowed (the agent will fall back to
  // outreach without a preselected vendor). Launch only requires at least one
  // institute — provider picking is optional.
  const canLaunch = pickedInstitutes.size > 0;

  const bundle: Bundle | null = useMemo(() => {
    if (!ctx) return null;
    return {
      query: ctx.rawQuery,
      samples: {
        institute_ids: Array.from(pickedInstitutes),
        specimen_ids: [],
        totals: {
          specimens: totalSpecimens,
          donors: totalDonors,
          institutes: selectedInstitutes.length,
        },
      },
      assays: assayChoices.map((a) => {
        const ids = selected[a.assay] ?? [];
        return {
          ...a,
          selected: a.candidates.filter((c) => ids.includes(c.id)),
        };
      }),
      selected_provider_ids: selected,
    };
  }, [ctx, pickedInstitutes, totalSpecimens, totalDonors, selectedInstitutes.length, assayChoices, selected]);

  if (!ctx) return null;

  return (
    <div className="bp">
      <header className="bp-top">
        <div className="bp-lead">
          <button className="bp-back" onClick={() => router.push("/workspace")}>← Back to results</button>
          <div className="bp-title-row">
            <span className="status mono">Bundle</span>
          </div>
          <h1 className="bp-title serif">{ctx.rawQuery}</h1>
          <div className="bp-meta mono-sm">
            {selectedInstitutes.length} institutes · {totalSpecimens.toLocaleString()} specimens · {totalDonors.toLocaleString()} donors · {assayChoices.length} assays
          </div>
        </div>
        <div className="bp-actions">
          <button
            className="btn-p brand"
            onClick={() => setHandoffOpen(true)}
            disabled={!canLaunch}
            title={!canLaunch ? "Pick at least one institute to launch" : undefined}
          >
            Launch agent →
          </button>
          {!canLaunch && (
            <div className="bp-launch-hint mono">Pick at least one institute to launch.</div>
          )}
        </div>
      </header>

      <div className="bp-body">
        <aside className="bp-rail">
          <SamplesRail
            institutes={institutes}
            picked={pickedInstitutes}
            onToggle={(id) => {
              const next = new Set(pickedInstitutes);
              next.has(id) ? next.delete(id) : next.add(id);
              setPickedInstitutes(next);
            }}
            onSelectAll={() => setPickedInstitutes(new Set(institutes.map((i) => i.organization_id)))}
            onClear={() => setPickedInstitutes(new Set())}
          />
        </aside>

        <main className="bp-main">
          {loading ? (
            <div className="bp-empty">Loading providers…</div>
          ) : assayChoices.length === 0 ? (
            <div className="bp-empty">
              No assays detected. Go back to refine the request — the parse step picks them up from the query.
            </div>
          ) : (
            <>
              <LaunchPreview
                instituteCount={selectedInstitutes.length}
                specimenCount={totalSpecimens}
                assayChoices={assayChoices}
                selected={selected}
              />
              <div className="bp-assays">
                {assayChoices.map((a) => (
                  <AssaySection
                    key={a.assay}
                    choice={a}
                    selectedIds={selected[a.assay] ?? []}
                    onToggle={(pid) =>
                      setSelected({ ...selected, [a.assay]: toggleId(selected[a.assay] ?? [], pid) })
                    }
                    onOpenProvider={(p) => setDrawerProvider({ provider: p, assay: a.assay })}
                  />
                ))}
              </div>
            </>
          )}
        </main>
      </div>

      {drawerProvider && (
        <ProviderDrawer
          provider={drawerProvider.provider}
          assay={drawerProvider.assay}
          isSelected={(selected[drawerProvider.assay] ?? []).includes(drawerProvider.provider.id)}
          onSelect={() => {
            setSelected({
              ...selected,
              [drawerProvider.assay]: toggleId(
                selected[drawerProvider.assay] ?? [],
                drawerProvider.provider.id,
              ),
            });
            setDrawerProvider(null);
          }}
          onClose={() => setDrawerProvider(null)}
        />
      )}

      <HandoffModal
        open={handoffOpen}
        onClose={() => setHandoffOpen(false)}
        rawQuery={ctx.rawQuery}
        parsed={ctx.parsed}
        result={ctx.result}
        bundle={bundle}
      />
    </div>
  );
}

function SamplesRail({
  institutes,
  picked,
  onToggle,
  onSelectAll,
  onClear,
}: {
  institutes: InstituteEntry[];
  picked: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  return (
    <div className="bp-rail-inner">
      <div className="bp-section-h mono">Sample set</div>
      <div className="bb-toolbar">
        <span className="bb-count mono">
          {picked.size}/{institutes.length} institutes
        </span>
        <div className="bb-tool-actions">
          <button className="hf-btn-secondary sm" onClick={onSelectAll}>All</button>
          <button className="hf-btn-secondary sm" onClick={onClear}>None</button>
        </div>
      </div>
      <ul className="bb-inst-list" style={{ maxHeight: "none" }}>
        {institutes.map((i) => (
          <li key={i.organization_id} className={picked.has(i.organization_id) ? "on" : ""}>
            <label>
              <input
                type="checkbox"
                checked={picked.has(i.organization_id)}
                onChange={() => onToggle(i.organization_id)}
              />
              <span className="bb-inst-name">{i.name}</span>
              <span className="bb-inst-meta mono">
                {(i.specimen_count ?? 0).toLocaleString()} sp · {(i.donor_count ?? 0).toLocaleString()} d · {i.country ?? "—"}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssaySection({
  choice,
  selectedIds,
  onToggle,
  onOpenProvider,
}: {
  choice: AssayChoice;
  selectedIds: string[];
  onToggle: (id: string) => void;
  onOpenProvider: (p: Provider) => void;
}) {
  const typeMix = useMemo(() => summarizeTypes(choice.candidates), [choice.candidates]);
  const selectedProvs = choice.candidates.filter((c) => selectedIds.includes(c.id));

  return (
    <section className="bp-assay-block">
      <header className="bp-assay-head">
        <div className="bp-assay-head-left">
          <div className="bp-assay-fam mono">{choice.family}</div>
          <h3 className="bp-assay-name">{choice.assay}</h3>
          <p className="bp-assay-explain">
            {choice.candidates.length === 0
              ? "No providers indexed for this assay — the agent will fall back to manual outreach."
              : `${choice.candidates.length} provider${choice.candidates.length === 1 ? "" : "s"} can run this assay${typeMix ? ` — ${typeMix}.` : "."} Pick any number — or none, and the agent will source them.`}
          </p>
        </div>
        <div className={`bp-assay-state ${selectedProvs.length > 0 ? "on" : ""}`}>
          {selectedProvs.length > 0 ? (
            <>
              <span className="bp-assay-state-lbl mono">
                {selectedProvs.length === 1 ? "Picked" : `${selectedProvs.length} picked`}
              </span>
              <span className="bp-assay-state-name">
                {selectedProvs.map((p) => p.name).join(" · ")}
              </span>
            </>
          ) : (
            <span className="bp-assay-state-lbl mono">No provider — agent will source</span>
          )}
        </div>
      </header>

      {choice.candidates.length > 0 && (
        <ul className="bp-prov-grid">
          {choice.candidates.slice(0, 6).map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              assay={choice.assay}
              selected={selectedIds.includes(p.id)}
              onPick={() => onToggle(p.id)}
              onOpen={() => onOpenProvider(p)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProviderCard({
  provider,
  assay,
  selected,
  onPick,
  onOpen,
}: {
  provider: Provider;
  assay: string;
  selected: boolean;
  onPick: () => void;
  onOpen: () => void;
}) {
  const why = whyMatches(provider, assay);
  const accred = provider.accreditation && provider.accreditation !== "—" ? provider.accreditation : null;
  const e = provider.enrichment;
  const sampleChips = e?.sample_types?.slice(0, 3) ?? [];
  const partnerN = e?.academic_partners?.length ?? 0;
  return (
    <li
      className={`bp-prov-card ${selected ? "on" : ""}`}
      onClick={onPick}
      role="button"
      tabIndex={0}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onPick();
        }
      }}
    >
      <div className="bp-prov-row">
        <span className="bp-prov-type mono">{providerTypeLabel(provider.type)}</span>
        <span className="bp-prov-country mono">{provider.country || "—"}</span>
      </div>
      <div className="bp-prov-name">{provider.name}</div>
      {provider.parent && <div className="bp-prov-parent mono">via {provider.parent}</div>}
      <div className="bp-prov-why">{why}</div>
      {e && (
        <div className="bp-prov-enrich">
          {e.publication_total > 0 && (
            <span className="bp-prov-pubs mono" title="Indexed PubMed papers since 2022">
              📄 {e.publication_total.toLocaleString()} pubs
            </span>
          )}
          {partnerN > 0 && (
            <span className="bp-prov-partners mono" title={e.academic_partners.slice(0, 5).map((p) => p.name).join("\n")}>
              · {partnerN} partners
            </span>
          )}
          {sampleChips.length > 0 && (
            <div className="bp-prov-samples">
              {sampleChips.map((s) => (
                <span key={s.type} className="bp-prov-sample-chip" title={`${s.n_papers} paper${s.n_papers === 1 ? "" : "s"}`}>
                  {s.type}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="bp-prov-foot">
        {accred && <span className="bp-prov-accred mono">{accred}</span>}
        <button
          type="button"
          className="bp-prov-details"
          onClick={(ev) => {
            ev.stopPropagation();
            onOpen();
          }}
        >
          Details ↗
        </button>
        <span className={`bp-prov-pick ${selected ? "on" : ""}`} aria-hidden="true">
          {selected ? "✓ picked · click to remove" : "Click to add"}
        </span>
      </div>
    </li>
  );
}

function whyMatches(p: Provider, assay: string): string {
  const target = assay.toLowerCase();
  const hitsSpecific = p.specific_assays.some((s) => s.toLowerCase().includes(target) || target.includes(s.toLowerCase()));
  const hitsFamily = p.assay_families.some((f) => f.toLowerCase().includes(target) || target.includes(f.toLowerCase()));

  if (p.type === "ip_platform") {
    const trials = p.n_trials ?? 0;
    const enroll = p.total_enrollment ?? 0;
    if (trials > 0) {
      return `Ran ${trials.toLocaleString()} clinical trial${trials === 1 ? "" : "s"} on this assay${enroll > 0 ? ` (${enroll.toLocaleString()} enrolled)` : ""} — IP-locked platform, only they can run it.`;
    }
    return "Owns the platform IP for this assay — only provider that can run it.";
  }
  if (p.type === "vendor") {
    return `Ships the instrument or kits used to run this assay${p.specific_assays.length ? ` (${p.specific_assays[0]})` : ""}. Buy + run in-house, no service contract.`;
  }
  // CRO of either kind
  const sampleN = p.sample_types.length;
  const basis = hitsSpecific
    ? `Lists "${assay}" as a specific assay`
    : hitsFamily
      ? `Runs the ${p.assay_families.find((f) => target.includes(f.toLowerCase()) || f.toLowerCase().includes(target))} family`
      : "Listed for this assay in their service catalog";
  const samples = sampleN > 0 ? ` · accepts ${sampleN} sample type${sampleN === 1 ? "" : "s"}` : "";
  return `${basis}${samples}.`;
}

function providerTypeLabel(t: Provider["type"]): string {
  switch (t) {
    case "service_cro": return "Service CRO";
    case "specialty_cro": return "Specialty CRO";
    case "ip_platform": return "IP platform";
    case "vendor": return "Vendor";
  }
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function summarizeTypes(candidates: Provider[]): string {
  if (candidates.length === 0) return "";
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const k = providerTypeLabel(c.type).toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`)
    .join(", ");
}

function LaunchPreview({
  instituteCount,
  specimenCount,
  assayChoices,
  selected,
}: {
  instituteCount: number;
  specimenCount: number;
  assayChoices: AssayChoice[];
  selected: Record<string, string[]>;
}) {
  const picks = assayChoices.map((a) => {
    const ids = selected[a.assay] ?? [];
    return { assay: a, providers: a.candidates.filter((c) => ids.includes(c.id)) };
  });
  const totalPicked = picks.reduce((n, p) => n + p.providers.length, 0);
  const assaysWithPicks = picks.filter((p) => p.providers.length > 0).length;
  const assaysWithoutPicks = assayChoices.length - assaysWithPicks;
  const ready = instituteCount > 0;

  return (
    <section className="bp-launch-preview">
      <div className="bp-launch-head">
        <div className="bp-launch-lbl mono">When you launch the agent</div>
        <div className={`bp-launch-state mono ${ready ? "ok" : "wait"}`}>
          {instituteCount === 0
            ? "Pick an institute"
            : totalPicked === 0
              ? `Ready · agent will source ${assayChoices.length} assay${assayChoices.length === 1 ? "" : "s"}`
              : `Ready · ${totalPicked} provider${totalPicked === 1 ? "" : "s"} picked across ${assaysWithPicks}/${assayChoices.length} assays`}
        </div>
      </div>
      <ol className="bp-launch-steps">
        <li>
          <span className="step-n mono">01</span>
          <span className="step-body">
            Email <strong>{instituteCount}</strong> institute{instituteCount === 1 ? "" : "s"} requesting access to <strong>{specimenCount.toLocaleString()}</strong> specimen{specimenCount === 1 ? "" : "s"}, plus terms and lead time.
          </span>
        </li>
        <li>
          <span className="step-n mono">02</span>
          <span className="step-body">
            {totalPicked === 0 ? (
              <>Source providers for <em>{assayChoices.map((a) => a.assay).join(", ")}</em> from the indexed catalog and brief them.</>
            ) : (
              <>
                Brief {picks
                  .filter((p) => p.providers.length > 0)
                  .map((p, i, arr) => (
                    <span key={p.assay.assay}>
                      <strong>{p.providers.map((pr) => pr.name).join(" + ")}</strong> for <em>{p.assay.assay}</em>{i < arr.length - 1 ? ", " : ""}
                    </span>
                  ))}
                {assaysWithoutPicks > 0 && (
                  <>; source providers for <em>{picks.filter((p) => p.providers.length === 0).map((p) => p.assay.assay).join(", ")}</em></>
                )}
                {" "}with the sample manifest, requesting a quote and turnaround.
              </>
            )}
          </span>
        </li>
        <li>
          <span className="step-n mono">03</span>
          <span className="step-body">
            Reconcile replies as they come in (typically 3–10 business days), flag conflicts (sample-type mismatch, capacity gaps), and surface a priced bundle for your sign-off.
          </span>
        </li>
      </ol>
    </section>
  );
}
