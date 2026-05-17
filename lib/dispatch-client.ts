// Client helpers for HandoffModal → /api/run + /api/audit wiring.

import type { SpecimenFilters } from "@/lib/filters";
import type { BiobankOpportunity } from "@/types/biobank";

export interface StagedActionPreview {
  supplier_id: string;
  supplier_name: string;
  channel: "email" | "form";
  action_id: string;
  reasoning: string;
  staged: unknown; // pass-through for /confirm
  preview: {
    target: string; // email or URL
    headline: string; // subject line or form name
    body: string; // utterance or formatted field list
  };
  status: "staged" | "sending" | "sent" | "failed";
  error?: string;
  result?: { target: string; ref: string }; // post-confirm summary
}

export async function startRun(input: {
  raw_query: string;
  parsed_filters: SpecimenFilters;
}): Promise<{ runId: string }> {
  const r = await fetch("/api/run/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`start failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as { runId: string };
}

export async function listSuppliers(): Promise<BiobankOpportunity[]> {
  const r = await fetch("/api/suppliers");
  if (!r.ok) throw new Error(`suppliers failed: ${r.status}`);
  const data = (await r.json()) as { suppliers: BiobankOpportunity[] };
  return data.suppliers;
}

async function stageOne(
  runId: string,
  supplier: BiobankOpportunity,
  channel: "email" | "form",
): Promise<StagedActionPreview | null> {
  if (channel === "email" && !supplier.contact.email) return null;
  if (channel === "form" && !supplier.contact.quote_form_url) return null;

  const r = await fetch(`/api/audit/${supplier.id}/${channel}/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId }),
  });
  if (!r.ok) {
    return {
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      channel,
      action_id: "(failed)",
      reasoning: "",
      staged: null,
      preview: {
        target: channel === "email" ? supplier.contact.email ?? "" : supplier.contact.quote_form_url ?? "",
        headline: `Stage failed for ${supplier.name}`,
        body: await r.text(),
      },
      status: "failed",
      error: `${r.status}`,
    };
  }
  const data = (await r.json()) as { staged: any };
  const built = data.staged.built;

  let preview: StagedActionPreview["preview"];
  if (channel === "email" && built.kind === "utterance") {
    preview = {
      target: supplier.contact.email ?? "",
      headline: deriveSubject(built.text),
      body: built.text,
    };
  } else if (channel === "form" && built.kind === "parameters") {
    const fieldList = Object.entries(built.values as Record<string, string>)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    preview = {
      target: supplier.contact.quote_form_url ?? "",
      headline: `Form: ${data.staged.action_id}`,
      body: fieldList,
    };
  } else {
    preview = { target: "", headline: data.staged.action_id, body: "" };
  }

  return {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    channel,
    action_id: data.staged.action_id,
    reasoning: data.staged.reasoning,
    staged: data.staged,
    preview,
    status: "staged",
  };
}

export async function stageAll(
  runId: string,
  suppliers: BiobankOpportunity[],
): Promise<StagedActionPreview[]> {
  const tasks: Promise<StagedActionPreview | null>[] = [];
  for (const s of suppliers) {
    tasks.push(stageOne(runId, s, "email"));
    tasks.push(stageOne(runId, s, "form"));
  }
  const results = await Promise.all(tasks);
  return results.filter((x): x is StagedActionPreview => x !== null);
}

export async function confirmOne(
  runId: string,
  preview: StagedActionPreview,
): Promise<{ ok: boolean; ref?: string; error?: string }> {
  const r = await fetch(`/api/audit/${preview.supplier_id}/${preview.channel}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, staged: preview.staged }),
  });
  if (!r.ok) return { ok: false, error: `${r.status} ${await r.text()}` };
  const data = (await r.json()) as { result: any };
  const ref =
    preview.channel === "email"
      ? data.result.send_result?.thread_id ?? data.result.send_result?.message_id ?? "sent"
      : data.result.submit_result?.submission_id ?? "submitted";
  return { ok: true, ref };
}

function deriveSubject(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? "Outreach";
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "…" : firstLine;
}
