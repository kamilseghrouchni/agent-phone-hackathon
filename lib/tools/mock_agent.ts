/**
 * Mock streaming agent for local UI testing without consuming Anthropic credits.
 *
 * Activated by CROVI_MOCK=1. Inspects the last user message, infers filters via
 * curated-query keyword match (or simple keywords on free queries), then drives
 * the same server-side tool functions to produce a realistic UI message stream.
 *
 * Goal: validate UI / mutation engine end-to-end. Does NOT validate LLM behavior.
 */
import fs from "node:fs";
import path from "node:path";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage, type UIMessageStreamWriter } from "ai";
import { queryspecimens } from "./query_specimens";
import { findpublications } from "./find_publications";
import { compareinstitutes } from "./compare_institutes";
import { openrequestform } from "./open_request_form";
import { mergeDelta, type SpecimenFilters } from "../filters";
import { orgs } from "../orgs";

type Curated = { id: string; role: string; label: string; text: string; bundle_id: string };

let _curated: Curated[] | null = null;
function curated(): Curated[] {
  if (_curated) return _curated;
  const p = path.join(process.cwd(), "data", "enriched", "curated_queries.json");
  _curated = JSON.parse(fs.readFileSync(p, "utf-8"));
  return _curated!;
}

let _bundles: Record<string, any> = {};
function bundleParsed(bundle_id: string): any {
  if (_bundles[bundle_id]) return _bundles[bundle_id];
  // Find the bundle by walking data/bundles/*/bundle_id/query.json
  const root = path.join(process.cwd(), "data", "bundles");
  const areas = fs.readdirSync(root).filter((f) => fs.statSync(path.join(root, f)).isDirectory());
  for (const a of areas) {
    const p = path.join(root, a, bundle_id, "query.json");
    if (fs.existsSync(p)) {
      _bundles[bundle_id] = JSON.parse(fs.readFileSync(p, "utf-8")).parsed ?? {};
      return _bundles[bundle_id];
    }
  }
  _bundles[bundle_id] = {};
  return {};
}

function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const t = (m.parts ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ");
    if (t) return t;
  }
  return "";
}

/** Keyword-driven filter inference for free queries that don't match a curated chip. */
function inferFreeFilters(text: string): SpecimenFilters {
  const t = text.toLowerCase();
  const f: SpecimenFilters = { free_text: text };

  const indMatch: [RegExp, string][] = [
    [/\bmm\b|multiple myeloma|myeloma/, "multiple myeloma"],
    [/melanoma/, "melanoma"],
    [/\btnbc\b|triple-negative breast/, "triple-negative breast cancer"],
    [/breast cancer|invasive ductal|\bidc\b/, "breast cancer"],
    [/lymphoma|follicular/, "lymphoma"],
    [/lung scc|squamous cell carcinoma/, "lung squamous cell carcinoma"],
    [/\bnsclc\b|non-small cell lung/, "non-small cell lung cancer"],
    [/colorectal|\bcrc\b/, "colorectal cancer"],
    [/parkinson/, "parkinson's disease"],
    [/alzheimer/, "alzheimer's disease"],
    [/\bms\b|multiple sclerosis/, "multiple sclerosis"],
    [/\bals\b|amyotrophic/, "amyotrophic lateral sclerosis"],
    [/glioblastoma|\bgbm\b/, "glioblastoma"],
    [/ovarian/, "ovarian cancer"],
    [/pancreatic|\bpdac\b/, "pancreatic ductal adenocarcinoma"],
    [/cholangio/, "cholangiocarcinoma"],
    [/prostate/, "prostate cancer"],
    [/cervical/, "cervical cancer"],
    [/diabetes/, "diabetes"],
    [/\bcopd\b/, "chronic obstructive pulmonary disease"],
    [/asthma/, "asthma"],
    [/\bchf\b|congestive heart failure/, "congestive heart failure"],
    [/covid|sars-cov-2/, "covid-19"],
  ];
  const inds: string[] = [];
  for (const [r, v] of indMatch) if (r.test(t)) inds.push(v);
  if (inds.length) f.indication = inds;

  const types: string[] = [];
  if (/\bbmmc|bone marrow/.test(t)) types.push("Bone marrow mononuclear cells (BMMCs)");
  if (/\bpbmc/.test(t)) types.push("Peripheral blood mononuclear cells (PBMCs)");
  if (/\bcsf|cerebrospinal/.test(t)) types.push("Cerebrospinal fluid (CSF)");
  if (/\bplasma\b/.test(t)) types.push("Plasma");
  if (/\bserum\b/.test(t)) types.push("Serum");
  if (/\bffpe|fixed tissue/.test(t)) types.push("Tissue (FFPE)");
  if (/\btissue\b/.test(t) && !types.length) types.push("Tissue");
  if (/\bbuffy/.test(t)) types.push("Buffy coat");
  if (/whole blood|\bblood\b/.test(t) && !types.some((s) => /lood/.test(s))) types.push("Whole blood");
  if (/\burine\b/.test(t)) types.push("Urine");
  if (types.length) f.specimen_types = types;

  if (/ffpe|fixed/.test(t)) f.preservation = "Fixed";
  else if (/frozen|-80/.test(t)) f.preservation = "Frozen";

  if (/longitudinal|multiple time|multiple visit|progression/.test(t)) f.longitudinal = true;
  if (/treatment-naive|treatment naive|untreated|pre-treatment/.test(t)) f.treatment_status = "naive";

  // Age range
  const ageMatch = t.match(/age[s]? (\d+)\+|(\d+)\+ years|over (\d+)|>= ?(\d+)/);
  if (ageMatch) {
    const v = Number(ageMatch[1] ?? ageMatch[2] ?? ageMatch[3] ?? ageMatch[4]);
    if (Number.isFinite(v)) f.age_range = [v, null];
  }

  return f;
}

/** Curated chips supply richer filters (drawn from the bundle's parsed query). */
function findCuratedFilters(text: string): { filters: SpecimenFilters; curatedRole: string } | null {
  const t = text.trim().toLowerCase();
  for (const c of curated()) {
    if (c.text.toLowerCase() === t) {
      const parsed = bundleParsed(c.bundle_id);
      const f: SpecimenFilters = {
        indication: parsed.indication?.slice(0, 3),
        specimen_types: parsed.specimen_types,
        preservation: parsed.preservation === "Fixed" ? "Fixed" : undefined,
        longitudinal: c.role === "longitudinal" ? true : undefined,
        treatment_status: parsed.treatment_status?.includes("aive") ? "naive" : undefined,
        min_n: parsed.min_n,
        free_text: c.text,
      };
      return { filters: f, curatedRole: c.role };
    }
  }
  return null;
}

/** Infer follow-up intent from common phrasings the demo guide names. */
function inferFollowUp(text: string): { tool: "query_specimens" | "compare_institutes"; delta?: SpecimenFilters; institute_ids?: string[]; narration: string } | null {
  const t = text.toLowerCase();
  if (/(drop|remove|filter out|without)[^.]*contact/.test(t)) {
    return { tool: "query_specimens", delta: { has_contact_email: true }, narration: "Filtering to institutes with a public contact email." };
  }
  if (/group by country/.test(t)) {
    return { tool: "query_specimens", delta: { display_grouping: "country" }, narration: "Same query, grouped by country." };
  }
  if (/only longitudinal/.test(t)) {
    return { tool: "query_specimens", delta: { longitudinal: true }, narration: "Restricting to donors with multi-year collections." };
  }
  if (/^compare /.test(t) || /vs\.?/.test(t)) {
    // Pick first 2 institutes from prior results — caller resolves via the orgs map
    const all = Object.values(orgs());
    const named = all.filter((o) => t.includes(o.name.toLowerCase().slice(0, 6)));
    if (named.length >= 2) {
      return { tool: "compare_institutes", institute_ids: named.slice(0, 2).map((o) => o.organization_id), narration: `Comparing ${named.slice(0, 2).map((o) => o.name).join(" vs ")}.` };
    }
    // Fallback: pick top 2 from any org with descriptions (so the table looks populated)
    const top = all.filter((o) => o.contact_email).slice(0, 2);
    return { tool: "compare_institutes", institute_ids: top.map((o) => o.organization_id), narration: `Comparing ${top.map((o) => o.name).join(" vs ")}.` };
  }
  return null;
}

// ===== Streaming helpers =====

function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function streamText(writer: UIMessageStreamWriter, text: string, chunkSize = 6, perChunkMs = 30) {
  const id = `t${Math.random().toString(36).slice(2, 8)}`;
  writer.write({ type: "text-start", id });
  for (let i = 0; i < text.length; i += chunkSize) {
    writer.write({ type: "text-delta", id, delta: text.slice(i, i + chunkSize) });
    await delay(perChunkMs);
  }
  writer.write({ type: "text-end", id });
}

async function streamToolCall(
  writer: UIMessageStreamWriter,
  toolName: string,
  input: any,
  output: any,
  inputDelayMs = 200
) {
  const toolCallId = `tc_${Math.random().toString(36).slice(2, 9)}`;
  writer.write({ type: "tool-input-start", toolCallId, toolName });
  // Stream the input as a single JSON delta (close enough to real LLM behavior for UI)
  await delay(inputDelayMs);
  writer.write({ type: "tool-input-delta", toolCallId, inputTextDelta: JSON.stringify(input) });
  writer.write({ type: "tool-input-available", toolCallId, toolName, input });
  await delay(inputDelayMs);
  writer.write({ type: "tool-output-available", toolCallId, output });
}

// ===== Public entry =====

export function mockAgentResponse(messages: UIMessage[]): Response {
  const userText = lastUserText(messages);

  // Reconstruct prior filters from messages (mirror the real route's tracking)
  const lastFilters: Record<string, SpecimenFilters> = {};
  for (const m of messages) {
    if (m.role !== "assistant" || !m.parts) continue;
    for (const p of m.parts as any[]) {
      if (p.type?.startsWith("tool-") && p.input) {
        const t = p.type.replace("tool-", "");
        if (t === "query_specimens" || t === "find_publications") {
          lastFilters[t] = mergeDelta(lastFilters[t], p.input);
        }
      }
    }
  }

  const stream = createUIMessageStream({
    execute: async ({ writer }: { writer: UIMessageStreamWriter }) => {
      try {
        writer.write({ type: "start", messageId: `m_${Math.random().toString(36).slice(2, 10)}` });
        writer.write({ type: "start-step" });

        const followUp = inferFollowUp(userText);
        if (followUp && Object.keys(lastFilters).length > 0) {
          // Follow-up turn
          if (followUp.tool === "compare_institutes" && followUp.institute_ids) {
            await streamText(writer, followUp.narration);
            const out = compareinstitutes(followUp.institute_ids);
            await streamToolCall(writer, "compare_institutes", { institute_ids: followUp.institute_ids }, out);
          } else if (followUp.tool === "query_specimens" && followUp.delta) {
            await streamText(writer, followUp.narration);
            const merged = mergeDelta(lastFilters.query_specimens, followUp.delta);
            const out = queryspecimens(merged);
            await streamToolCall(writer, "query_specimens", followUp.delta, out);
          }
          writer.write({ type: "finish-step" });
          writer.write({ type: "finish" });
          return;
        }

        // First turn (or unmatched query)
        const curatedHit = findCuratedFilters(userText);
        const filters: SpecimenFilters = curatedHit?.filters ?? inferFreeFilters(userText);
        const role = curatedHit?.curatedRole;

        await streamText(writer, "Reading your request — extracting indication, specimen type, and preanalytical hints.");

        const out = queryspecimens(filters);
        await streamToolCall(writer, "query_specimens", filters, out);
        lastFilters.query_specimens = mergeDelta(lastFilters.query_specimens, filters);

        // Brief mid-narration
        const summary =
          out.totals.specimens > 0
            ? `Surfaced ${out.totals.institutes} institutes with ${out.totals.specimens.toLocaleString()} specimens. Looking for literature backing.`
            : `No commercial specimens matched. Checking literature for adjacent academic biobanks.`;
        await streamText(writer, summary);

        // Always run find_publications for the demo so the panel shows something
        const pubs = findpublications(filters);
        await streamToolCall(writer, "find_publications", filters, pubs);

        // For impossible / thin results, also open a wider-sourcing form
        if (out.totals.specimens === 0 || (role === "thin-result")) {
          const formData = openrequestform({
            scope: "source_wider",
            query_text: userText,
            specifics: "",
          });
          await streamText(writer, "Want me to commission a wider sourcing pass? I can open a request form.");
          await streamToolCall(writer, "open_request_form", { scope: "source_wider", query_text: userText }, formData);
        } else {
          await streamText(writer, "Click any institute to expand its dossier, or ask me to refine.");
        }

        writer.write({ type: "finish-step" });
        writer.write({ type: "finish" });
      } catch (err: any) {
        writer.write({ type: "error", errorText: err?.message ?? String(err) });
      }
    },
    onError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  });

  return createUIMessageStreamResponse({ stream });
}
