// app/api/intake/route.ts
//
// Accepts a PDF upload (multipart) OR a pasted text query (JSON), hashes the
// PDF, and dispatches to:
//   - sample-extractor (hash-fast-path for the bundled NovaCure sample)
//   - LLM fallback via /api/parse (text input or unknown PDFs)
//
// Returns the IntakeForm + run_id so the workspace can route to Beat 2.

import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import {
  computeSha256,
  extractBundledSample,
  isBundledSample,
} from "@/lib/intake/sample-extractor";
import { writeIntake } from "@/lib/store/runs";
import { categorizeIntake } from "@/lib/intake/categorize";
import type { IntakeForm } from "@/types/intake";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const run_id = randomUUID();
  const contentType = req.headers.get("content-type") ?? "";

  // --- PDF upload (multipart) ---
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return Response.json({ error: "missing file" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = computeSha256(buffer);

    if (isBundledSample({ hash, filename: file.name })) {
      const intake = extractBundledSample(run_id, hash, file.name);
      writeIntake(run_id, intake);
      return Response.json({ run_id, intake, source: "sample-fastpath" });
    }

    // TODO(other-agent): real PDF parse via pdf-parse + Claude Sonnet fallback.
    // For trunk compilation we return a minimal empty intake so callers can
    // proceed; the LLM extractor agent will replace this branch.
    const intake = emptyIntake(run_id, { type: "pdf", filename: file.name, hash });
    writeIntake(run_id, intake);
    return Response.json({ run_id, intake, source: "pdf-stub" });
  }

  // --- Pasted text fallback ---
  let query = "";
  try {
    const body = (await req.json()) as { query?: string };
    query = body.query?.trim() ?? "";
  } catch {
    // fall through
  }
  if (!query) {
    return Response.json({ error: "missing query or file" }, { status: 400 });
  }

  // TODO(other-agent): pipe `query` into LLM extractor and back-fill 35 fields.
  // For trunk compilation, return a minimal empty intake.
  const intake = emptyIntake(run_id, { type: "text" });
  writeIntake(run_id, intake);
  return Response.json({ run_id, intake, source: "text-stub" });
}

function emptyIntake(run_id: string, source: IntakeForm["source"]): IntakeForm {
  return categorizeIntake(
    run_id,
    source,
    { company: "", contact: "", email: "", phone: "" },
    {},
  );
}
