"use client";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ProspectiveCard } from "@/lib/prospective";

export function ProspectiveDetail({
  card,
  onAddToHandoff,
}: {
  card: ProspectiveCard;
  onAddToHandoff?: () => void;
}) {
  const sections = useMemo(() => splitLayer2(card.layer2Markdown), [card.layer2Markdown]);

  return (
    <>
      <div className="det-title-row">
        <div style={{ flex: 1 }}>
          <div className="lbl">Prospective partner</div>
          <div className="det-title">{card.institution}</div>
          <div className="det-sub">{card.location}</div>
        </div>
        {onAddToHandoff && (
          <button className="btn-p brand" onClick={onAddToHandoff}>
            Launch agents →
          </button>
        )}
      </div>

      {card.matched && (
        <section className="det-section">
          <div className="prosp-signal">
            <div className="prosp-signal-row">
              <span className="prosp-signal-tag mono-sm">OPPORTUNITY SIGNAL</span>
              <span className="prosp-signal-area mono-sm">{card.matched.area}</span>
            </div>
            <p className="prosp-signal-fact">{card.matched.fact}</p>
            <div className="prosp-signal-why mono-sm">
              Population on hand · prior activity proven — the two conditions a prospective
              collection actually needs.
            </div>
          </div>
        </section>
      )}

      <section className="det-section">
        <div className="prosp-facts">
          <Fact label="Pool" value={card.layer1.poolSize} />
          <Fact label="Steward" value={card.layer1.steward} />
          <Fact label="Access path" value={card.layer1.accessPath} accent />
        </div>
      </section>

      <section className="det-section">
        <div className="sect-lbl">Deep dive</div>
        <div className="prosp-md">
          {sections.map((s, i) => (
            <details key={i} className="prosp-section">
              <summary className="prosp-section-summary">
                <span className="prosp-section-title">{s.title}</span>
                <span className="prosp-section-chev">▸</span>
              </summary>
              <div className="prosp-section-body">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noreferrer" style={{ color: "var(--brand-ink)" }}>
                        {children}
                      </a>
                    ),
                    table: ({ children }) => <table className="prosp-md-table">{children}</table>,
                  }}
                >
                  {s.body}
                </ReactMarkdown>
              </div>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}

function Fact({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`prosp-fact ${accent ? "accent" : ""}`}>
      <div className="prosp-fact-k mono-sm">{label}</div>
      <div className="prosp-fact-v">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => <span>{children}</span>,
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noreferrer" style={{ color: "var(--brand-ink)" }}>
                {children}
              </a>
            ),
          }}
        >
          {value}
        </ReactMarkdown>
      </div>
    </div>
  );
}

type Section = { title: string; body: string };

function splitLayer2(md: string): Section[] {
  const headingRe = /^###\s+(.+?)\s*$/gm;
  const matches = [...md.matchAll(headingRe)];
  if (!matches.length) return [];
  const out: Section[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.index == null) continue;
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : md.length;
    out.push({ title: m[1].trim(), body: md.slice(start, end).trim() });
  }
  return out;
}
