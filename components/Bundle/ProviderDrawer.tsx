"use client";
import { useEffect } from "react";
import type { Provider } from "@/lib/bundle";

export function ProviderDrawer({
  provider,
  assay,
  isSelected,
  onSelect,
  onClose,
}: {
  provider: Provider;
  assay: string;
  isSelected: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const accred = provider.accreditation && provider.accreditation !== "—" ? provider.accreditation : null;
  const evidenceIsUrl = provider.evidence?.startsWith("http");
  const e = provider.enrichment;

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside className="drawer pd-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="pd-head">
          <div className="pd-head-top">
            <span className="pd-type mono">{typeLabel(provider.type)}</span>
            <button className="pd-close" onClick={onClose} aria-label="Close">×</button>
          </div>
          <h2 className="pd-name">{provider.name}</h2>
          {provider.parent && <div className="pd-parent mono">via {provider.parent}</div>}
          <div className="pd-sub mono">For assay · {assay}</div>
        </header>

        <section className="pd-section">
          <div className="pd-lbl mono">Why surfaced</div>
          <p className="pd-body">{whyDetailed(provider, assay)}</p>
        </section>

        {provider.specific_assays.length > 0 && (
          <section className="pd-section">
            <div className="pd-lbl mono">Listed assays</div>
            <div className="pd-pills">
              {provider.specific_assays.map((s) => (
                <span key={s} className="pd-pill">{s}</span>
              ))}
            </div>
          </section>
        )}

        {provider.assay_families.length > 0 && (
          <section className="pd-section">
            <div className="pd-lbl mono">Assay families</div>
            <div className="pd-pills">
              {provider.assay_families.map((f) => (
                <span key={f} className="pd-pill subtle">{f}</span>
              ))}
            </div>
          </section>
        )}

        {provider.sample_types.length > 0 && (
          <section className="pd-section">
            <div className="pd-lbl mono">Accepted sample types</div>
            <div className="pd-pills">
              {provider.sample_types.map((s) => (
                <span key={s} className="pd-pill subtle">{s}</span>
              ))}
            </div>
          </section>
        )}

        <section className="pd-section pd-grid">
          <div>
            <div className="pd-lbl mono">Country</div>
            <div className="pd-body">{provider.country || "—"}</div>
          </div>
          {accred && (
            <div>
              <div className="pd-lbl mono">Accreditation</div>
              <div className="pd-body">{accred}</div>
            </div>
          )}
          {provider.n_trials != null && provider.n_trials > 0 && (
            <div>
              <div className="pd-lbl mono">Clinical trials run</div>
              <div className="pd-body">
                {provider.n_trials.toLocaleString()}
                {provider.total_enrollment ? ` (${provider.total_enrollment.toLocaleString()} enrolled)` : ""}
              </div>
            </div>
          )}
        </section>

        {(provider.url || provider.services_url || provider.evidence) && (
          <section className="pd-section">
            <div className="pd-lbl mono">Links</div>
            <div className="pd-links">
              {provider.url && (
                <a href={provider.url} target="_blank" rel="noopener noreferrer" className="pd-link">Website ↗</a>
              )}
              {provider.services_url && provider.services_url !== provider.url && (
                <a href={provider.services_url} target="_blank" rel="noopener noreferrer" className="pd-link">Service catalog ↗</a>
              )}
              {provider.evidence && evidenceIsUrl && (
                <a href={provider.evidence} target="_blank" rel="noopener noreferrer" className="pd-link">Trial evidence ↗</a>
              )}
            </div>
          </section>
        )}

        {e && (
          <>
            <section className="pd-section pd-enrich-summary">
              <div className="pd-lbl mono">Published evidence</div>
              <div className="pd-body">
                <strong>{e.publication_total.toLocaleString()}</strong> PubMed papers since 2022
                {e.publications_indexed ? ` · ${e.publications_indexed} sampled to extract facts below` : ""}
              </div>
              {e.address_hint && (
                <div className="pd-enrich-addr mono-sm">📍 {e.address_hint}</div>
              )}
            </section>

            {e.contact_emails.length > 0 && (
              <section className="pd-section">
                <div className="pd-lbl mono">Contact (corresponding authors)</div>
                <div className="pd-emails">
                  {e.contact_emails.map((m) => (
                    <a key={m} href={`mailto:${m}`} className="pd-email-link mono-sm">✉ {m}</a>
                  ))}
                </div>
              </section>
            )}

            {e.sample_types.length > 0 && (
              <section className="pd-section">
                <div className="pd-lbl mono">Sample types touched in literature</div>
                <ul className="pd-samples">
                  {e.sample_types.map((s) => (
                    <li key={s.type} className="pd-sample-row">
                      <span className="pd-sample-name">{s.type}</span>
                      <span className="pd-sample-meta mono-sm">
                        {s.n_papers} paper{s.n_papers === 1 ? "" : "s"}
                        {s.evidence_pmids.length > 0 && (
                          <>
                            {" · "}
                            {s.evidence_pmids.map((pmid, i) => (
                              <span key={pmid}>
                                {i > 0 && ", "}
                                <a
                                  href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="pd-pmid-link"
                                >
                                  {pmid}
                                </a>
                              </span>
                            ))}
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {e.indication_areas.length > 0 && (
              <section className="pd-section">
                <div className="pd-lbl mono">Indication areas</div>
                <div className="pd-pills">
                  {e.indication_areas.map((i) => (
                    <span key={i.area} className="pd-pill">
                      {i.area}
                      <span className="pd-pill-n mono-sm"> · {i.n_papers}</span>
                    </span>
                  ))}
                </div>
              </section>
            )}

            {e.academic_partners.length > 0 && (
              <section className="pd-section">
                <div className="pd-lbl mono">Worked with</div>
                <ul className="pd-partners">
                  {e.academic_partners.map((p) => (
                    <li key={p.name} className="pd-partner-row">
                      <span className="pd-partner-name">{p.name}</span>
                      <span className="pd-partner-n mono-sm">{p.co_pubs}× co-pubs</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {e.top_publications.length > 0 && (
              <section className="pd-section">
                <div className="pd-lbl mono">Recent publications</div>
                <ul className="pd-pubs">
                  {e.top_publications.slice(0, 5).map((pub) => (
                    <li key={pub.pmid} className="pd-pub-row">
                      <a
                        href={pub.doi ? `https://doi.org/${pub.doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pd-pub-link"
                      >
                        {pub.title}
                      </a>
                      <div className="pd-pub-meta mono-sm">
                        {pub.journal || "—"} · {pub.year ?? "—"} · PMID {pub.pmid}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <footer className="pd-foot">
          <button className="hf-btn-secondary" onClick={onClose}>Close</button>
          <button className={`btn-p brand ${isSelected ? "is-selected" : ""}`} onClick={onSelect}>
            {isSelected ? "Already picked — keep" : "Pick this provider"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function typeLabel(t: Provider["type"]): string {
  switch (t) {
    case "service_cro": return "Service CRO";
    case "specialty_cro": return "Specialty CRO";
    case "ip_platform": return "IP platform";
    case "vendor": return "Vendor";
  }
}

function whyDetailed(p: Provider, assay: string): string {
  const target = assay.toLowerCase();
  const hitsSpecific = p.specific_assays.some((s) => s.toLowerCase().includes(target) || target.includes(s.toLowerCase()));
  const hitsFamily = p.assay_families.some((f) => f.toLowerCase().includes(target) || target.includes(f.toLowerCase()));

  if (p.type === "ip_platform") {
    const trials = p.n_trials ?? 0;
    if (trials > 0) {
      return `${p.name} owns the IP for this assay and ran ${trials.toLocaleString()} trials with it on ClinicalTrials.gov${p.total_enrollment ? ` totalling ${p.total_enrollment.toLocaleString()} enrolled patients` : ""}. They are the only provider that can run this assay end-to-end.`;
    }
    return `${p.name} owns the platform IP for this assay. They are the only provider that can run it; CROs and vendors are not an alternative.`;
  }
  if (p.type === "vendor") {
    return `${p.name} ships the instrument or kits used to run "${assay}". A CRO would buy these to run the assay on your behalf, or you could buy and run in-house. They do not run the assay as a service.`;
  }
  const basis = hitsSpecific
    ? `lists "${assay}" as a specific assay in their service catalog`
    : hitsFamily
      ? `runs the ${p.assay_families.find((f) => target.includes(f.toLowerCase()) || f.toLowerCase().includes(target))} family, which covers this assay`
      : "appears in the assay catalog as a known provider";
  return `${p.name} ${basis}. ${p.sample_types.length > 0 ? `They accept ${p.sample_types.length} sample types — confirm match against your manifest before sending.` : "Confirm the sample-type match against your manifest before sending."}`;
}
