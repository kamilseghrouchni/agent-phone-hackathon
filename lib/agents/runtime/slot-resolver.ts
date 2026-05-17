// Slot source resolver. Walks a `source` path string against a typed
// context object. Source grammar matches what the YAML loader validates:
//
//   parsed_query.<path>          fields from the user's ParsedQuery
//   supplier.<path>              fields from the BiobankOpportunity
//   prior.<action_id>.<field>    extraction from an earlier turn
//   cross_channel.<field>        Supermemory cross-channel query result
//   agent_identity.<field>       BD persona for this supplier
//   state.<path>                 runtime state bag (run_id, etc.)
//
// Path supports:
//   .<key>             dot walk
//   [<integer>]        array index
//   [key=value]        find-by-attribute  (e.g. specimens[type=plasma])

import type { ParsedQuery } from "@/types/parsed-query";
import type { BiobankOpportunity } from "@/types/biobank";
import { formatValue } from "./formatters";

export interface AgentIdentity {
  name: string;
  email: string;
  phone?: string;
  company: string;
  country?: string;
}

export interface ResolveContext {
  parsed_query: ParsedQuery;
  supplier: BiobankOpportunity;
  prior: Record<string, Record<string, unknown>>; // {action_id: {field: value}}
  cross_channel: Record<string, unknown>;
  agent_identity: AgentIdentity;
  state: Record<string, unknown>;
}

export type SlotResolver =
  | { source: string; format?: string; fallback?: string | number | boolean }
  | { literal: string | number | boolean };

const PREFIXES = ["parsed_query", "supplier", "prior", "cross_channel", "agent_identity", "state"] as const;
type Prefix = typeof PREFIXES[number];

function tokenisePath(path: string): string[] {
  // "specimens[type=plasma].n_cases" → ["specimens", "[type=plasma]", "n_cases"]
  const tokens: string[] = [];
  let buf = "";
  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    if (ch === ".") {
      if (buf) {
        tokens.push(buf);
        buf = "";
      }
    } else if (ch === "[") {
      if (buf) {
        tokens.push(buf);
        buf = "";
      }
      const close = path.indexOf("]", i);
      if (close === -1) throw new Error(`Unbalanced bracket in path "${path}"`);
      tokens.push(path.slice(i, close + 1));
      i = close;
    } else {
      buf += ch;
    }
  }
  if (buf) tokens.push(buf);
  return tokens;
}

function walk(obj: unknown, tokens: string[]): unknown {
  let cur: unknown = obj;
  for (const tok of tokens) {
    if (cur == null) return undefined;
    if (tok.startsWith("[") && tok.endsWith("]")) {
      const inner = tok.slice(1, -1);
      if (/^\d+$/.test(inner)) {
        if (!Array.isArray(cur)) return undefined;
        cur = cur[parseInt(inner, 10)];
      } else if (inner.includes("=")) {
        const [k, v] = inner.split("=");
        if (!Array.isArray(cur)) return undefined;
        cur = (cur as unknown[]).find(
          (it) => typeof it === "object" && it !== null && (it as Record<string, unknown>)[k] === v,
        );
      } else {
        return undefined;
      }
    } else {
      if (typeof cur !== "object" || cur === null) return undefined;
      cur = (cur as Record<string, unknown>)[tok];
    }
  }
  return cur;
}

function rootFor(prefix: Prefix, ctx: ResolveContext): unknown {
  switch (prefix) {
    case "parsed_query": return ctx.parsed_query;
    case "supplier": return ctx.supplier;
    case "prior": return ctx.prior;
    case "cross_channel": return ctx.cross_channel;
    case "agent_identity": return ctx.agent_identity;
    case "state": return ctx.state;
  }
}

export function resolveSlot(slot: SlotResolver, ctx: ResolveContext): string {
  if ("literal" in slot) return formatValue(slot.literal);
  const dot = slot.source.indexOf(".");
  if (dot < 1) throw new Error(`Slot source missing prefix: "${slot.source}"`);
  const prefix = slot.source.slice(0, dot) as Prefix;
  if (!PREFIXES.includes(prefix)) {
    throw new Error(`Unknown slot source prefix "${prefix}" in "${slot.source}"`);
  }
  const path = slot.source.slice(dot + 1);
  const root = rootFor(prefix, ctx);
  const value = path.length === 0 ? root : walk(root, tokenisePath(path));

  if (value == null || value === "") {
    if (slot.fallback !== undefined) return String(slot.fallback);
    return "";
  }
  return formatValue(value, slot.format);
}

export function resolveSlots(
  slots: Record<string, SlotResolver>,
  ctx: ResolveContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(slots)) {
    out[k] = resolveSlot(v, ctx);
  }
  return out;
}
