"use client";
import { useState } from "react";
import type { QuerySpecimensResult, InstituteEntry } from "@/lib/tools/query_specimens";

export function InstituteList({ data }: { data: QuerySpecimensResult }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const grouping = data.filters_applied.display_grouping;

  if (!data.institutes.length) {
    return <div className="empty-canvas">No institutes matched. Try a broader sourcing.</div>;
  }

  if (grouping === "country") {
    const groups = data.groupings.by_country;
    return (
      <div className="inst-list">
        {Object.entries(groups)
          .sort((a, b) => b[1].count - a[1].count)
          .map(([country, info]) => (
            <div key={country} className="inst">
              <div className="inst-row">
                <div className="inst-name">{country}</div>
                <span className="tag">{info.count.toLocaleString()} specimens</span>
                <span className="tag">{info.institutes.length} institutes</span>
                <span />
              </div>
              <div className="inst-detail">
                <div className="row"><div className="k">Institutes</div><div className="v">{info.institutes.join(" · ")}</div></div>
              </div>
            </div>
          ))}
      </div>
    );
  }

  return (
    <div className="inst-list">
      {data.institutes.map((i) => (
        <InstituteCard
          key={i.organization_id}
          inst={i}
          expanded={expandedId === i.organization_id}
          onToggle={() => setExpandedId((p) => (p === i.organization_id ? null : i.organization_id))}
        />
      ))}
    </div>
  );
}

function InstituteCard({ inst, expanded, onToggle }: { inst: InstituteEntry; expanded: boolean; onToggle: () => void }) {
  return (
    <div className={`inst ${expanded ? "expanded" : ""}`} onClick={onToggle}>
      <div className="inst-row">
        <div>
          <div className="inst-name">{inst.name}</div>
          {!inst.in_profiles && <span className="tag warn" style={{ marginTop: 4 }}>profile missing</span>}
        </div>
        <span className="inst-flag" title={inst.country ?? ""}>{inst.flag}</span>
        <span className="inst-n">{inst.specimen_count.toLocaleString()} sp · {inst.donor_count.toLocaleString()} donors</span>
        <span className="tag brand">match {inst.match_score}</span>
      </div>
      {expanded && (
        <div className="inst-detail" onClick={(e) => e.stopPropagation()}>
          {inst.description && <div className="row"><div className="k">About</div><div className="v">{inst.description}</div></div>}
          <div className="row">
            <div className="k">Specimens</div>
            <div className="v spec-mini">
              {Object.entries(inst.by_specimen_type)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([t, n]) => <span key={t} className="pill">{t} · {n.toLocaleString()}</span>)}
            </div>
          </div>
          {inst.longitudinal_donor_count > 0 && (
            <div className="row"><div className="k">Longitudinal</div><div className="v">{inst.longitudinal_donor_count.toLocaleString()} donors with ≥2 collection years</div></div>
          )}
          {inst.sample_rows.length > 0 && (
            <div className="row">
              <div className="k">Sample rows</div>
              <div className="v" style={{ display: "grid", gap: 4 }}>
                {inst.sample_rows.map((r) => (
                  <div key={r.specimen_id} style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-2)" }}>
                    {r.specimen_id.slice(0, 12)}… · {r.specimen_type ?? "—"} · {r.sex ?? "—"} {r.age ? `· ${r.age}y` : ""} {r.year ? `· ${r.year}` : ""}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="row">
            <div className="k">Contact</div>
            <div className="v">
              {inst.contact_email ? (
                <a href={`mailto:${inst.contact_email}`} style={{ color: "var(--brand-ink)" }}>{inst.contact_email}</a>
              ) : (
                <span className="tag warn">no public contact</span>
              )}
              {inst.website && (
                <> &middot; <a href={inst.website} target="_blank" rel="noreferrer" style={{ color: "var(--brand-ink)" }}>website</a></>
              )}
            </div>
          </div>
          <div className="actions">
            <button className="btn-p brand">Audit deeper</button>
            <button className="btn-o">Request quote</button>
          </div>
        </div>
      )}
    </div>
  );
}
