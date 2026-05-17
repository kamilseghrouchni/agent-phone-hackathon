/**
 * Agent route — script-driven orchestrator.
 *
 * No Sonnet. The flow:
 *   1. Reconstruct prior filters + institute IDs from the message history.
 *   2. routeIntent() — regex follow-up patterns, Haiku fallback for free text.
 *   3. Execute the matching tool deterministically.
 *   4. Compute anomalies from the result, narrate via Haiku.
 *   5. Stream UI events (text-deltas + tool-call events) to the client.
 *
 * Mock mode (CROVI_MOCK=1) still routes to mock_agent for local UI work.
 */
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageStreamWriter,
} from "ai";
import { queryspecimens } from "@/lib/tools/query_specimens";
import { findpublications } from "@/lib/tools/find_publications";
import { compareinstitutes } from "@/lib/tools/compare_institutes";
import { openrequestform } from "@/lib/tools/open_request_form";
import { mergeDelta, type SpecimenFilters } from "@/lib/filters";
import { mockAgentResponse } from "@/lib/tools/mock_agent";
import { routeIntent, type Intent } from "@/lib/router/intent";
import { computeAnomalies } from "@/lib/router/anomaly";
import { narrate } from "@/lib/router/narrate";
import { isDemoModeActive, synthesizeDemoResult } from "@/lib/demo-suppliers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json()) as {
    messages: UIMessage[];
    parsedFilters?: SpecimenFilters;
  };
  const { messages, parsedFilters } = body;

  if (process.env.CROVI_MOCK === "1") {
    return mockAgentResponse(messages);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "ANTHROPIC_API_KEY not set",
        hint: "Add it to .env.local and restart `npm run dev` — or set CROVI_MOCK=1 for the local demo without an API key.",
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }

  const userText = lastUserText(messages);
  const { lastFilters, priorInstituteIds } = reconstructPriorState(messages);

  const stream = createUIMessageStream({
    execute: async ({ writer }: { writer: UIMessageStreamWriter }) => {
      try {
        writer.write({ type: "start", messageId: `m_${Math.random().toString(36).slice(2, 10)}` });
        writer.write({ type: "start-step" });

        const intent = await routeIntent({
          userText,
          hasPriorState: Object.keys(lastFilters).length > 0,
          priorInstituteIds,
          preparsedFilters: parsedFilters,
        });

        await runIntent(writer, intent, lastFilters, userText);

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

async function runIntent(
  writer: UIMessageStreamWriter,
  intent: Intent,
  lastFilters: Record<string, SpecimenFilters>,
  userText: string,
) {
  const isFirstTurn = Object.keys(lastFilters).length === 0;

  if (intent.kind === "follow_up_compare") {
    await streamSentence(writer, intent.hint);
    const out = compareinstitutes(intent.institute_ids);
    await streamToolCall(writer, "compare_institutes", { institute_ids: intent.institute_ids }, out);
    return;
  }

  // Both follow_up_query and first_query end up calling query_specimens with a
  // delta merged onto prior state. Difference: the lead-in sentence and whether
  // we auto-trigger publications + open_request_form afterwards.
  const delta = intent.kind === "follow_up_query" ? intent.delta : intent.filters;
  const lead =
    intent.kind === "follow_up_query"
      ? intent.hint
      : isFirstTurn
        ? "Reading your request — extracting indication, specimen type, and preanalytical hints."
        : "Refining the query.";

  await streamSentence(writer, lead);
  const merged = mergeDelta(lastFilters.query_specimens, delta);
  // Demo mode: the 6 hardcoded commercial CROs ARE the workspace cards.
  // The real specimens.db query is bypassed entirely so beat 3 ("6 cards
  // land") and beat 5 ("Geneticist quoted $1,200") fire against the named
  // supplier identities the demo narrative depends on.
  const result = isDemoModeActive()
    ? synthesizeDemoResult(merged)
    : queryspecimens(merged);
  await streamToolCall(writer, "query_specimens", delta, result);
  lastFilters.query_specimens = merged;

  const anomalies = computeAnomalies(result);
  const judgment = await narrate({
    context: lead,
    anomalies,
    totals: {
      specimens: result.totals.specimens,
      donors: result.totals.donors,
      institutes: result.totals.institutes,
    },
  });
  if (judgment) await streamSentence(writer, judgment);

  if (intent.kind === "first_query" && isFirstTurn) {
    const pubs = findpublications(merged);
    await streamToolCall(writer, "find_publications", merged, pubs);

    if (result.totals.specimens === 0) {
      await streamSentence(writer, "Want me to commission a wider sourcing pass? I can open a request form.");
      const formData = openrequestform({
        scope: "source_wider",
        query_text: userText,
        specifics: "",
      });
      await streamToolCall(writer, "open_request_form", { scope: "source_wider", query_text: userText }, formData);
    } else {
      await streamSentence(writer, "Click any institute to expand its dossier, or ask me to refine.");
    }
  }
}

// ===== State reconstruction =====

function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const t = (m.parts ?? [])
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join(" ");
    if (t) return t;
  }
  return "";
}

function reconstructPriorState(messages: UIMessage[]): {
  lastFilters: Record<string, SpecimenFilters>;
  priorInstituteIds: string[];
} {
  const lastFilters: Record<string, SpecimenFilters> = {};
  const idsSeen = new Set<string>();

  for (const m of messages) {
    if (m.role !== "assistant" || !m.parts) continue;
    for (const p of m.parts as any[]) {
      if (!p.type?.startsWith("tool-")) continue;
      const toolName = p.type.replace("tool-", "");

      if (p.input && (toolName === "query_specimens" || toolName === "find_publications")) {
        lastFilters[toolName] = mergeDelta(lastFilters[toolName], p.input);
      }

      if (p.output && toolName === "query_specimens") {
        const out = p.output as { institutes?: { organization_id: string }[] };
        for (const inst of out.institutes ?? []) {
          if (inst?.organization_id) idsSeen.add(inst.organization_id);
        }
      }
    }
  }

  return { lastFilters, priorInstituteIds: Array.from(idsSeen) };
}

// ===== UI stream helpers =====

async function streamSentence(writer: UIMessageStreamWriter, text: string) {
  if (!text) return;
  const id = `t${Math.random().toString(36).slice(2, 8)}`;
  writer.write({ type: "text-start", id });
  writer.write({ type: "text-delta", id, delta: text });
  writer.write({ type: "text-end", id });
}

async function streamToolCall(
  writer: UIMessageStreamWriter,
  toolName: string,
  input: any,
  output: any,
) {
  const toolCallId = `tc_${Math.random().toString(36).slice(2, 9)}`;
  writer.write({ type: "tool-input-start", toolCallId, toolName });
  writer.write({ type: "tool-input-delta", toolCallId, inputTextDelta: JSON.stringify(input) });
  writer.write({ type: "tool-input-available", toolCallId, toolName, input });
  writer.write({ type: "tool-output-available", toolCallId, output });
}
