"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { IntakeForm } from "@/types/intake";

/**
 * Dropzone — PDF drop primary surface for the demo.
 *
 * On success, stashes the IntakeForm + run_id in sessionStorage and routes to
 * the workspace which picks them up to render Beat 2 (ConfirmStrip).
 */
export function Dropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadPdf(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/intake", { method: "POST", body: fd });
      if (!r.ok) throw new Error(`intake failed: ${r.status}`);
      const data = (await r.json()) as { run_id: string; intake: IntakeForm };
      stashAndRoute(data.run_id, data.intake);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  function stashAndRoute(run_id: string, intake: IntakeForm) {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(`crovi_intake_${run_id}`, JSON.stringify(intake));
    }
    router.push(`/workspace?runId=${encodeURIComponent(run_id)}&phase=confirm`);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && /\.pdf$/i.test(file.name)) uploadPdf(file);
  }

  return (
    <div className="dz-wrap">
      <div
        className={`dz ${dragOver ? "over" : ""} ${busy ? "busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadPdf(f);
          }}
        />
        <div className="dz-icon" aria-hidden>📄</div>
        <div className="dz-prim serif">
          {busy ? "Reading your intake…" : "Drop your intake PDF here"}
        </div>
        <div className="dz-sub">or click to browse</div>
      </div>

      {error && <div className="dz-error mono-sm">{error}</div>}
    </div>
  );
}
