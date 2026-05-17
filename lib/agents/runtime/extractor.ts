// Extractor — narrow LLM call. Given the action's `extracts` schema and
// the counterparty response (email body, transcript chunk, form receipt
// HTML, whatever), pulls out structured {field: {value, evidence_quote}}
// JSON.
//
// The Zod schema is built dynamically per action, so the LLM is hard-
// constrained to the fields the action declares. Unknown extra fields
// are dropped by Zod.

import { z } from "zod";
import { extract as llmExtract } from "@/lib/llm";
import type { Action } from "../action-spaces/schema";

// Simple type→Zod converter. The YAML uses free-form type strings;
// we map the common ones to permissive shapes and treat everything
// else as optional string.
function fieldSchema(typeStr: string): z.ZodTypeAny {
  const t = typeStr.trim().toLowerCase();
  if (t === "string") return z.string().optional().nullable();
  if (t === "number") return z.number().optional().nullable();
  if (t === "boolean") return z.boolean().optional().nullable();
  if (t.startsWith("dict<")) return z.record(z.string(), z.unknown()).optional().nullable();
  if (t.startsWith("enum:")) {
    const opts = t.slice(5).split("|").map((s) => s.trim()).filter(Boolean);
    if (opts.length > 0) {
      return z.enum(opts as [string, ...string[]]).optional().nullable();
    }
  }
  return z.string().optional().nullable();
}

function buildExtractSchema(action: Action): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const ex of action.extracts ?? []) {
    shape[ex.field] = z
      .object({
        value: fieldSchema(ex.type),
        evidence_quote: z.string().optional().nullable(),
      })
      .optional()
      .nullable();
  }
  // Always allow an empty object — supplier may have answered nothing relevant.
  return z.object(shape).partial();
}

export interface ExtractInput {
  action: Action;
  counterparty_response: string;
  context_hint?: string; // optional pre-amble (transcript so far, thread context, etc.)
}

export async function runExtractor(input: ExtractInput): Promise<Record<string, { value: unknown; evidence_quote?: string }>> {
  const { action, counterparty_response, context_hint } = input;
  if ((action.extracts ?? []).length === 0) {
    return {};
  }

  const schema = buildExtractSchema(action);

  const fieldList = action.extracts
    .map((ex) => `  - ${ex.field}: ${ex.type}${ex.description ? ` — ${ex.description}` : ""}`)
    .join("\n");

  const system = `You extract structured fields from a counterparty response.
Action: ${action.id}
Fields to extract:
${fieldList}

For each field present in the response, emit { value, evidence_quote }.
- value: typed per the field's declared type. Use null if the response doesn't mention it.
- evidence_quote: ≤120 chars verbatim from the response that supports the value.
If the response doesn't mention a field at all, OMIT it. Do not invent values.`;

  const prompt = `${context_hint ? `Context:\n${context_hint}\n\n` : ""}Counterparty response:\n"""\n${counterparty_response}\n"""`;

  const result = (await llmExtract({ system, response: prompt, schema })) as Record<
    string,
    { value: unknown; evidence_quote?: string } | null | undefined
  >;

  // Strip nulls/undefined.
  const out: Record<string, { value: unknown; evidence_quote?: string }> = {};
  for (const [k, v] of Object.entries(result ?? {})) {
    if (v == null) continue;
    out[k] = v;
  }
  return out;
}
