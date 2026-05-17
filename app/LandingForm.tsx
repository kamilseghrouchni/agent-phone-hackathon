"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Curated = { id: string; role: string; label: string; text: string; bundle_id: string; expected_difficulty: string };

export function LandingForm({ curated }: { curated: Curated[] }) {
  const router = useRouter();
  const [text, setText] = useState("");

  const go = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    // Pass the query in the URL so the workspace re-parses on each new run,
    // even if the route component is preserved in Next.js's router cache.
    router.push(`/workspace?q=${encodeURIComponent(trimmed)}&t=${Date.now()}`);
  };

  return (
    <div className="q-form">
      <textarea
        className="q-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Bone marrow from MM patients for single-cell RNA-seq…"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(text); }
        }}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn-p brand" onClick={() => go(text)} disabled={!text.trim()}>Run</button>
        <span style={{ color: "var(--text-3)", fontSize: 12 }}>⌘↵ to submit · or pick a curated example below</span>
      </div>
      <div>
        <span className="lbl-h" style={{ display: "block", marginBottom: 8, fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-3)" }}>Curated examples</span>
        <div className="chips">
          {curated.map((c) => (
            <button key={c.id} className="chip" onClick={() => go(c.text)}>
              <span className="role">{c.role}</span>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
