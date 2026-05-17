"use client";
import { useState } from "react";
import type { OpenRequestFormResult } from "@/lib/tools/open_request_form";

export function RequestForm({ data }: { data: OpenRequestFormResult }) {
  const [scope, setScope] = useState<"audit_deeper" | "source_wider">(data.scope);
  const [specifics, setSpecifics] = useState(data.prefill.specifics ?? "");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState<{ id: string } | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    const payload = {
      scope,
      institute_ids: data.prefill.institute_ids ?? [],
      query_text: data.prefill.query_text ?? "",
      specifics: specifics.trim(),
      email: email.trim(),
      submitted_at: new Date().toISOString(),
    };
    const id = `REQ-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const stored = JSON.parse(localStorage.getItem("crovi_requests") ?? "[]");
    stored.push({ id, ...payload });
    localStorage.setItem("crovi_requests", JSON.stringify(stored));
    console.log("[crovi] request submitted:", id, payload);
    setSubmitted({ id });
  };

  if (submitted) {
    return (
      <div className="req">
        <div>
          <span className="tag brand">queued</span>
          <div style={{ fontSize: 14, marginTop: 8, lineHeight: 1.5 }}>
            Request <code style={{ fontFamily: "var(--mono)" }}>{submitted.id}</code> is queued. We'll email you within 48h with{" "}
            {scope === "audit_deeper" ? "audit findings" : "sourcing options"}.
          </div>
        </div>
      </div>
    );
  }

  return (
    <form className="req" onSubmit={submit}>
      <div>
        <span className="lbl-h">Scope</span>
        <div className="scope-toggle">
          <button type="button" className={scope === "audit_deeper" ? "on" : ""} onClick={() => setScope("audit_deeper")}>Audit deeper</button>
          <button type="button" className={scope === "source_wider" ? "on" : ""} onClick={() => setScope("source_wider")}>Source wider</button>
        </div>
      </div>
      {data.prefill.institute_ids?.length ? (
        <div>
          <span className="lbl-h">Institutes</span>
          <div style={{ fontSize: 13, color: "var(--text-2)" }}>{data.prefill.institute_ids.length} institute{data.prefill.institute_ids.length === 1 ? "" : "s"} selected</div>
        </div>
      ) : null}
      <div>
        <span className="lbl-h">{scope === "audit_deeper" ? "What needs verifying?" : "What's missing?"}</span>
        <textarea
          rows={3}
          placeholder={
            scope === "audit_deeper"
              ? "donor consent scope, exact storage temp, treatment-naive subset count…"
              : "wider geography, larger N, extended preanalytical, alternative cohorts…"
          }
          value={specifics}
          onChange={(e) => setSpecifics(e.target.value)}
        />
      </div>
      <div>
        <span className="lbl-h">Email for findings</span>
        <input type="email" placeholder="you@lab.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="actions">
        <button type="submit" className="btn-p brand">Launch</button>
      </div>
    </form>
  );
}
