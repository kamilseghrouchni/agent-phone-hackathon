#!/usr/bin/env node
// Dump full input schema for transfer + submit_plan. Read-only.

import fs from "fs";
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf-8").split("\n")
    .filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i=l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).split(" #")[0].trim()]; }),
);

const URL = env.SPONGE_MCP_URL ?? "https://api.wallet.paysponge.com/mcp";
const KEY = env.SPONGE_API_KEY_SENDER;
let nextId = 0, session = null;

async function post(payload, notify) {
  const h = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26" };
  if (session) h["Mcp-Session-Id"] = session;
  const r = await fetch(URL, { method: "POST", headers: h, body: JSON.stringify(payload) });
  const sid = r.headers.get("mcp-session-id");
  if (sid && !session) session = sid;
  if (notify) return;
  const t = await r.text();
  const c = r.headers.get("content-type") ?? "";
  let b;
  if (c.includes("text/event-stream")) {
    const d = t.split(/\r?\n/).map(l=>l.trim()).find(l=>l.startsWith("data:"));
    b = JSON.parse(d.slice(5).trim());
  } else b = JSON.parse(t);
  if (b.error) throw new Error(b.error.message);
  return b.result;
}

await post({ jsonrpc:"2.0", id:++nextId, method:"initialize", params:{ protocolVersion:"2025-03-26", capabilities:{}, clientInfo:{ name:"inspect", version:"0" }}});
await post({ jsonrpc:"2.0", method:"notifications/initialized", params:{}}, true).catch(()=>{});

const tl = await post({ jsonrpc:"2.0", id:++nextId, method:"tools/list", params:{}});
const target = ["transfer", "submit_plan", "propose_trade"];
for (const name of target) {
  const t = tl.tools.find(x => x.name === name);
  if (!t) { console.log(`\n# ${name}: NOT FOUND`); continue; }
  console.log(`\n# ${name}`);
  console.log(`  description: ${t.description?.slice(0, 200)}`);
  const s = t.inputSchema ?? {};
  console.log(`  required: ${JSON.stringify(s.required ?? [])}`);
  console.log(`  properties:`);
  for (const [k, v] of Object.entries(s.properties ?? {})) {
    const type = v.type ?? (v.enum ? v.enum.join("|") : "any");
    const desc = v.description ? "  — " + v.description.slice(0, 90).replace(/\n/g, " ") : "";
    console.log(`    · ${k.padEnd(22)} ${String(type).padEnd(12)}${desc}`);
  }
}
