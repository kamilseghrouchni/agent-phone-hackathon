// ActionReasoningLog writer + cross-channel query.
//
// The spec calls for Supermemory-backed persistence (§ 3.1). For Phase A
// we ship a disk-backed implementation under store/runs/<runId>/reasoning-log/
// — same interface, same query semantics. Drop in the real Supermemory
// adapter at A4-A5 by swapping `appendRecord` and `queryCrossChannel`.
//
// Each record is one JSON file: <ts>-<channel>-<action_id>.json. The
// directory listing IS the index; no separate database needed for now.

import fs from "fs";
import path from "path";
import type { ActionReasoningLog } from "@/types/action-log";
import type { Channel } from "@/types/biobank";

function logDir(runDir: string): string {
  return path.join(runDir, "reasoning-log");
}

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export async function appendRecord(runDir: string, record: ActionReasoningLog): Promise<void> {
  const dir = logDir(runDir);
  fs.mkdirSync(dir, { recursive: true });
  const ts = record.timestamp.replace(/[:.]/g, "-");
  const file = path.join(dir, `${ts}-${safeName(record.channel)}-${safeName(record.action_id)}.json`);
  await fs.promises.writeFile(file, JSON.stringify(record, null, 2));
}

export async function listRecords(runDir: string): Promise<ActionReasoningLog[]> {
  const dir = logDir(runDir);
  if (!fs.existsSync(dir)) return [];
  const files = (await fs.promises.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const out: ActionReasoningLog[] = [];
  for (const f of files) {
    const raw = await fs.promises.readFile(path.join(dir, f), "utf-8");
    out.push(JSON.parse(raw));
  }
  return out;
}

// Spec § 3.3 cross-channel leverage query.
// Returns prior records from any supplier OTHER than `currentSupplierId`
// whose `output` mentions any of `infoNeeds`. The Planner uses this to
// gate cross_channel_required actions.
export async function queryCrossChannel(opts: {
  runDir: string;
  currentSupplierId: string;
  infoNeeds: string[];
}): Promise<ActionReasoningLog[]> {
  const { runDir, currentSupplierId, infoNeeds } = opts;
  const records = await listRecords(runDir);
  return records.filter((r) => {
    if (r.supplier_id === currentSupplierId) return false;
    if (infoNeeds.length === 0) return true; // any prior cross-channel evidence counts
    return infoNeeds.some((field) => Object.prototype.hasOwnProperty.call(r.output, field));
  });
}

// Returns the most recent record per (supplier, action) for this channel
// — used by `prior.<action_id>.<field>` slot resolution.
export async function priorByAction(opts: {
  runDir: string;
  supplierId: string;
  channel: Channel;
}): Promise<Record<string, Record<string, unknown>>> {
  const { runDir, supplierId, channel } = opts;
  const records = (await listRecords(runDir)).filter(
    (r) => r.supplier_id === supplierId && r.channel === channel,
  );
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of records) {
    // Flatten output to {field: value} where output may be {field: {value, evidence_quote}} or raw.
    const flat: Record<string, unknown> = {};
    for (const [field, raw] of Object.entries(r.output)) {
      if (raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>)) {
        flat[field] = (raw as { value: unknown }).value;
      } else {
        flat[field] = raw;
      }
    }
    out[r.action_id] = flat;
  }
  return out;
}
