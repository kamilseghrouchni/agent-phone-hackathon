import Link from "next/link";
import { notFound } from "next/navigation";
import { loadOpportunity, fmtUSD, type Gate, type Provider } from "@/lib/opportunity";
import { LaunchButton } from "@/components/Opportunity/LaunchButton";

const gateToneMap: Record<Gate["status"], string> = {
  pass: "verified",
  partial: "inferred",
  open: "open-q",
  fail: "refuted",
};

const gateLabelMap: Record<Gate["status"], string> = {
  pass: "PASS",
  partial: "PARTIAL",
  open: "OPEN",
  fail: "FAIL",
};

function GateRow({ g }: { g: Gate }) {
  return (
    <li className="opp-gate">
      <span className={`lbl ${gateToneMap[g.status]}`}>
        <span className="sq" />
        {gateLabelMap[g.status]}
      </span>
      <span className="opp-gate-label">{g.label}</span>
      <span className="opp-gate-evidence">{g.evidence}</span>
    </li>
  );
}

function MiniBars({ data }: { data: { type: string; n: number }[] }) {
  const max = Math.max(...data.map((d) => d.n));
  return (
    <ul className="opp-mix">
      {data.map((d) => (
        <li key={d.type}>
          <span className="opp-mix-l">{d.type}</span>
          <span className="opp-mix-bar">
            <span style={{ width: `${(d.n / max) * 100}%` }} />
          </span>
          <span className="opp-mix-n mono">{d.n.toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

function ProviderBlock({ p }: { p: Provider }) {
  return (
    <article className="opp-prov">
      <header className="opp-prov-hd">
        <div className="opp-prov-title">
          <span className="tag brand">{p.kind}</span>
          <h3 className="serif">{p.name}</h3>
          <div className="opp-prov-org">{p.org} · {p.country}</div>
        </div>
        <div className="opp-prov-quote-meta mono">
          quoted {p.quote.negotiated_on} · valid until {p.quote.valid_until}
        </div>
      </header>

      <div className="opp-prov-body">
        <div className="opp-prov-col">
          <h4 className="opp-h">People</h4>
          <ul className="opp-people">
            {p.people.map((person) => (
              <li key={person.email}>
                <div className="opp-person-name">{person.name}</div>
                <div className="opp-person-role">{person.role}</div>
                <a className="opp-person-email mono" href={`mailto:${person.email}`}>{person.email}</a>
              </li>
            ))}
          </ul>

          <h4 className="opp-h" style={{ marginTop: 18 }}>Responsibilities</h4>
          <ul className="opp-resp">
            {p.quote.responsibilities.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>

        <div className="opp-prov-col">
          <h4 className="opp-h">Quote</h4>
          <table className="opp-quote">
            <thead>
              <tr>
                <th>Line</th>
                <th>Qty</th>
                <th>Unit</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {p.quote.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.label}</td>
                  <td className="num">{l.qty}</td>
                  <td className="mono opp-quote-unit">{l.unit}</td>
                  <td className="num">{fmtUSD(l.amount)}</td>
                </tr>
              ))}
              <tr className="opp-quote-sub">
                <td colSpan={3}>Subtotal</td>
                <td className="num"><b>{fmtUSD(p.quote.subtotal)}</b></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="opp-prov-col">
          <h4 className="opp-h">Timeline</h4>
          <ol className="opp-timeline v-stepper">
            {p.timeline.map((t, i) => {
              const isLast = i === p.timeline.length - 1;
              return (
                <li key={i} className={`v-step ${isLast ? "active" : "done"}`}>
                  <span className="node">{i + 1}</span>
                  <div className="opp-tl-grow">
                    <div className="opp-tl-date mono">{t.date}</div>
                    <div className="opp-tl-milestone">{t.milestone}</div>
                    <div className="opp-tl-owner">{t.owner}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </article>
  );
}

export default async function OpportunityDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const opp = loadOpportunity(id);
  if (!opp) notFound();

  const dispatchAgents = [
    { label: "DUA dispatch", detail: `Crovi → ${opp.providers[0].people[2]?.email ?? opp.providers[0].people[0].email}` },
    { label: "MSA lock", detail: `Crovi → ${opp.providers[1].people[1].email}` },
    { label: "Donor manifest watcher", detail: "Pings Camille Trottier weekly until residual confirm" },
    { label: "Cold-chain QC dispatch", detail: "Books courier slot at viability-test clearance" },
    { label: "Milestone tracker", detail: "Posts updates to Aulus inbox + this dashboard" },
    { label: "Final dossier compiler", detail: "Bundles HD4 data + bridge report on 2026-12-08" },
  ];

  return (
    <main className="opp-dash">
      {/* Header */}
      <header className="opp-dash-top">
        <div className="opp-dash-crumbs mono">
          <Link href="/">Crovi</Link>
          <span aria-hidden="true">›</span>
          <Link href={`/opportunity/${opp.id}`}>Email</Link>
          <span aria-hidden="true">›</span>
          <span>Dashboard</span>
        </div>
        <div className="opp-dash-title-row">
          <h1 className="serif opp-dash-title">{opp.title}</h1>
          <div className="opp-dash-status">
            <span className="pill brand"><span className="live-dot" /> {opp.path_chosen.label}</span>
            <span className="pill outline-brand">Audit complete</span>
          </div>
        </div>
        <div className="opp-dash-meta mono">
          <span>{opp.indication}</span>
          <span className="opp-dot" />
          <span>{opp.program}</span>
          <span className="opp-dot" />
          <span>Sponsor · {opp.sponsor.org}</span>
          <span className="opp-dot" />
          <span>Coordinator · {opp.coordinator.org}</span>
        </div>
      </header>

      {/* Source strip — how we got here */}
      <section className="opp-src">
        <div className="opp-src-l mono">How we arrived here</div>
        <div className="opp-src-items">
          <Link href={`/opportunity/${opp.id}`} className="opp-src-chip">
            <span className="opp-src-kind mono">email</span>
            <span className="opp-src-name">{opp.email.subject}</span>
          </Link>
          {opp.email.attachments.map((a) => (
            <a
              key={a.name}
              href={a.path}
              download={a.name}
              target={a.kind === "html" ? "_blank" : undefined}
              rel={a.kind === "html" ? "noopener noreferrer" : undefined}
              className="opp-src-chip"
            >
              <span className="opp-src-kind mono">{a.kind}</span>
              <span className="opp-src-name">{a.name}</span>
              <span className="opp-src-size mono">{a.size}</span>
            </a>
          ))}
        </div>
      </section>

      {/* Specimens + Assays */}
      <section className="opp-two-col">
        {/* Specimens */}
        <div className="card-cream opp-panel">
          <header className="opp-panel-hd">
            <span className="tag brand">Specimens</span>
            <h2 className="serif">Cohort on file</h2>
            <div className="opp-panel-headline">{opp.specimens_summary.headline}</div>
          </header>

          <div className="opp-stat-row">
            <div className="opp-stat">
              <div className="opp-stat-n serif">{opp.specimens_summary.totals.donors_total}</div>
              <div className="opp-stat-l mono">donors total</div>
            </div>
            <div className="opp-stat">
              <div className="opp-stat-n serif">{opp.specimens_summary.totals.donors_multivisit}</div>
              <div className="opp-stat-l mono">multi-visit</div>
            </div>
            <div className="opp-stat">
              <div className="opp-stat-n serif">{opp.specimens_summary.totals.specimens_recent_2020plus.toLocaleString()}</div>
              <div className="opp-stat-l mono">specimens · 2020+</div>
            </div>
          </div>

          <h4 className="opp-h">Type mix · 2020+</h4>
          <MiniBars data={opp.specimens_summary.type_mix_recent} />

          <h4 className="opp-h">Audit gates</h4>
          <ul className="opp-gates">
            {opp.specimens_summary.gates.map((g, i) => <GateRow key={i} g={g} />)}
          </ul>

          <a
            href={opp.specimens_summary.report_path}
            target="_blank"
            rel="noopener noreferrer"
            className="opp-open-report"
          >
            Open full audit report →
          </a>
        </div>

        {/* Assays */}
        <div className="card-cream opp-panel">
          <header className="opp-panel-hd">
            <span className="tag brand">Assays</span>
            <h2 className="serif">{opp.assays_summary.platform}</h2>
            <div className="opp-panel-headline">{opp.assays_summary.headline}</div>
          </header>

          <div className="opp-block">
            <h4 className="opp-h">Scope</h4>
            <p className="opp-body">{opp.assays_summary.scope}</p>
          </div>

          <h4 className="opp-h">Deliverables</h4>
          <ul className="opp-deliv">
            {opp.assays_summary.deliverables.map((d, i) => (
              <li key={i}><span className="opp-tick" aria-hidden="true">▸</span>{d}</li>
            ))}
          </ul>

          <h4 className="opp-h">Audit gates</h4>
          <ul className="opp-gates">
            {opp.assays_summary.gates.map((g, i) => <GateRow key={i} g={g} />)}
          </ul>

          <a
            href={opp.assays_summary.report_path}
            target="_blank"
            rel="noopener noreferrer"
            className="opp-open-report"
          >
            Open full audit report →
          </a>
        </div>
      </section>

      {/* Quotes per provider */}
      <section className="opp-section">
        <header className="opp-section-hd">
          <h2 className="serif">Negotiated quotes</h2>
          <span className="opp-section-sub">Two providers, one path. Quotes locked through {opp.providers[0].quote.valid_until}.</span>
        </header>
        <div className="opp-prov-list">
          {opp.providers.map((p) => <ProviderBlock key={p.id} p={p} />)}
        </div>

        {/* Total summary */}
        <div className="opp-totals">
          <div className="opp-total-row">
            <span>Biobank · {opp.providers[0].name}</span>
            <span className="num mono">{fmtUSD(opp.totals.biobank_subtotal)}</span>
          </div>
          <div className="opp-total-row">
            <span>Assay · {opp.providers[1].name}</span>
            <span className="num mono">{fmtUSD(opp.totals.assay_subtotal)}</span>
          </div>
          <div className="opp-total-row">
            <span>Coordination · {opp.coordinator.org}</span>
            <span className="num mono">{fmtUSD(opp.totals.coordinator_fee)}</span>
          </div>
          <div className="opp-total-row opp-grand">
            <span>Grand total · {opp.totals.currency}</span>
            <span className="num serif">{fmtUSD(opp.totals.grand_total)}</span>
          </div>
          <div className="opp-total-meta mono">
            kickoff {opp.totals.estimated_kickoff} · data delivery {opp.totals.estimated_data_delivery}
          </div>
        </div>
      </section>

      {/* Mock contract */}
      <section className="opp-section">
        <header className="opp-section-hd">
          <h2 className="serif">{opp.contract.title}</h2>
          <span className="pill outline-brand">{opp.contract.version}</span>
        </header>

        <div className="opp-contract">
          <div className="opp-contract-grid">
            <div>
              <h4 className="opp-h">Parties</h4>
              <ul className="opp-parties">
                {opp.contract.parties.map((p, i) => (
                  <li key={i}>
                    <span className="opp-party-role mono">{p.role}</span>
                    <span className="opp-party-entity">{p.entity}</span>
                    <span className="opp-party-sig">signatory · {p.signatory}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="opp-h">Term</h4>
              <p className="opp-body">{opp.contract.term}</p>

              <h4 className="opp-h">Payment terms</h4>
              <p className="opp-body">{opp.contract.payment_terms}</p>

              <h4 className="opp-h">Governing law · confidentiality · retention</h4>
              <ul className="opp-list-tight">
                <li>{opp.contract.governing_law}</li>
                <li>{opp.contract.confidentiality}</li>
                <li>{opp.contract.data_retention}</li>
              </ul>
            </div>
          </div>

          <h4 className="opp-h">Scope of work</h4>
          <ul className="opp-list">
            {opp.contract.scope_of_work.map((s, i) => <li key={i}>{s}</li>)}
          </ul>

          <h4 className="opp-h">Responsibilities</h4>
          <div className="opp-raci">
            {opp.contract.responsibilities.map((r, i) => (
              <div key={i} className="opp-raci-col">
                <div className="opp-raci-h mono">{r.party}</div>
                <ul>
                  {r.items.map((it, j) => <li key={j}>{it}</li>)}
                </ul>
              </div>
            ))}
          </div>

          <h4 className="opp-h">IP & data</h4>
          <ul className="opp-list">
            {opp.contract.ip_and_data.map((i, idx) => <li key={idx}>{i}</li>)}
          </ul>

          <h4 className="opp-h">Open items before signature</h4>
          <ul className="opp-open-items">
            {opp.contract.open_items.map((it, i) => (
              <li key={i}><span className="lbl open-q"><span className="sq" />OPEN</span>{it}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Launch */}
      <section className="opp-section opp-launch-section">
        <LaunchButton opportunityTitle={opp.title} agents={dispatchAgents} />
      </section>
    </main>
  );
}
