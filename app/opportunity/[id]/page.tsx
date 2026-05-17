import Link from "next/link";
import { notFound } from "next/navigation";
import { loadOpportunity } from "@/lib/opportunity";

const Initials = ({ name }: { name: string }) => {
  const i = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  return <span className="gm-avatar">{i}</span>;
};

const AttachmentIcon = ({ kind }: { kind: string }) => {
  const fill =
    kind === "xlsx" ? "#0F7B43" : kind === "html" ? "#6B6560" : "#A09890";
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        stroke={fill}
        strokeWidth="1.4"
      />
      <path d="M13 3v6h5" stroke={fill} strokeWidth="1.4" />
    </svg>
  );
};

export default async function OpportunityEmailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const opp = loadOpportunity(id);
  if (!opp) notFound();
  const e = opp.email;

  return (
    <main className="gm-shell">
      {/* Top bar */}
      <header className="gm-top">
        <div className="gm-top-left">
          <span className="gm-burger" aria-hidden="true">≡</span>
          <Link href="/" className="gm-mark">
            <img src="/crovi-logo.svg" alt="" />
            <span>Mail</span>
          </Link>
        </div>
        <div className="gm-search">
          <span aria-hidden="true">🔍</span>
          <input
            placeholder="Search mail"
            defaultValue={`from:${e.from.email}`}
            readOnly
          />
        </div>
        <div className="gm-top-right">
          <span className="gm-acct">{e.to.email}</span>
        </div>
      </header>

      <div className="gm-body">
        {/* Sidebar */}
        <aside className="gm-side">
          <button className="gm-compose" type="button" disabled>
            <span aria-hidden="true">＋</span>Compose
          </button>
          <ul className="gm-folders">
            <li className="on">
              <span aria-hidden="true">📥</span>Inbox<span className="gm-count">1</span>
            </li>
            <li><span aria-hidden="true">⭐</span>Starred</li>
            <li><span aria-hidden="true">⏰</span>Snoozed</li>
            <li><span aria-hidden="true">➤</span>Sent</li>
            <li><span aria-hidden="true">📝</span>Drafts</li>
            <li><span aria-hidden="true">🏷</span>Important</li>
            <li><span aria-hidden="true">🗑</span>Trash</li>
          </ul>
          <div className="gm-side-foot mono">labels · meet · chat</div>
        </aside>

        {/* Email pane */}
        <section className="gm-pane">
          {/* Toolbar */}
          <div className="gm-pane-tools">
            <Link href="/" className="gm-tool" aria-label="Back to inbox">←</Link>
            <span className="gm-tool" aria-hidden="true">📁</span>
            <span className="gm-tool" aria-hidden="true">⚠</span>
            <span className="gm-tool" aria-hidden="true">🗑</span>
            <span className="gm-tool-spacer" />
            <span className="gm-tool-meta mono">1 of 1</span>
          </div>

          {/* Subject line */}
          <div className="gm-subject-row">
            <h1 className="gm-subject">{e.subject}</h1>
            <span className="pill brand gm-label">Inbox</span>
            <span className="pill outline-brand gm-label">Audit</span>
          </div>

          {/* Sender block */}
          <div className="gm-sender">
            <Initials name={e.from.name} />
            <div className="gm-sender-grow">
              <div className="gm-sender-l1">
                <b>{e.from.name}</b>
                <span className="gm-email-addr">&lt;{e.from.email}&gt;</span>
              </div>
              <div className="gm-sender-l2">
                to <span>{e.to.name}</span>
                {e.cc && e.cc.length > 0 && (
                  <>
                    {" · cc "}
                    {e.cc.map((c, i) => (
                      <span key={i}>
                        {c.name}
                        {i < e.cc!.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>
            <div className="gm-sender-meta">
              <span className="gm-date">{e.date}</span>
              <div className="gm-sender-icons">
                <span aria-hidden="true">⭐</span>
                <span aria-hidden="true">↩</span>
                <span aria-hidden="true">⋮</span>
              </div>
            </div>
          </div>

          {/* Body */}
          <article className="gm-body-text">
            {e.body_paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            <p className="gm-signoff">
              {e.signoff.map((line, i) => (
                <span key={i}>
                  {line}
                  <br />
                </span>
              ))}
            </p>
          </article>

          {/* Attachments */}
          <div className="gm-attach-block">
            <div className="gm-attach-h mono">
              {e.attachments.length} attachment{e.attachments.length === 1 ? "" : "s"}
            </div>
            <div className="gm-attach-grid">
              {e.attachments.map((a) => (
                <a
                  key={a.name}
                  href={a.path}
                  download={a.name}
                  className="gm-attach"
                  target={a.kind === "html" ? "_blank" : undefined}
                  rel={a.kind === "html" ? "noopener noreferrer" : undefined}
                >
                  <div className="gm-attach-preview">
                    <AttachmentIcon kind={a.kind} />
                    <div className="gm-attach-kind mono">{a.kind}</div>
                  </div>
                  <div className="gm-attach-meta">
                    <div className="gm-attach-name">{a.name}</div>
                    <div className="gm-attach-size mono">{a.size}</div>
                  </div>
                </a>
              ))}
            </div>
          </div>

          {/* CTA into dashboard — replaces the reply box on this fixture */}
          <div className="gm-cta-row">
            <Link
              href={`/opportunity/${opp.id}/dashboard`}
              className="btn-p brand gm-cta"
            >
              Open opportunity dashboard →
            </Link>
            <span className="gm-cta-help mono">
              Specimens · assays · quotes · contract · launch
            </span>
          </div>

          {/* Reply mockup, faded */}
          <div className="gm-reply">
            <div className="gm-reply-l">↩ Reply</div>
            <div className="gm-reply-l">↪ Forward</div>
          </div>
        </section>
      </div>
    </main>
  );
}
