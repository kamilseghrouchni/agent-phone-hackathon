import type { FindPublicationsResult } from "@/lib/tools/find_publications";

export function PublicationPanel({ data }: { data: FindPublicationsResult }) {
  if (!data.papers.length) {
    return (
      <div className="pub-empty">
        No curated literature backs this query yet. Commission a literature scan to surface academic biobanks.
      </div>
    );
  }
  return (
    <div className="pubs">
      {data.papers.map((p, i) => (
        <div key={`${p.pmid ?? p.pmc_id ?? i}`} className="pub">
          <div className="title">{p.title}</div>
          <div className="meta">
            {p.journal ?? "—"} · {p.year ?? "—"} · {p.institution ?? "unknown institution"}
          </div>
          <div className="pmid">
            {p.pmid && `PMID:${p.pmid}`}{p.pmc_id && `  ${p.pmc_id}`}
          </div>
          {p.notes && <div className="notes">{p.notes}</div>}
          {p.access_route && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-2)" }}>
              <span className="tag">access</span> {p.access_route}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
