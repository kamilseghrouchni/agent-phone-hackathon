#!/usr/bin/env node
// Dump raw get_balance response for each Sponge key — all chains, all tokens.
// Read-only. No funds moved.

import fs from "fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf-8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).split(" #")[0].trim()];
    }),
);

const URL = env.SPONGE_MCP_URL ?? "https://api.wallet.paysponge.com/mcp";
const KEYS = ["SPONGE_API_KEY", "SPONGE_API_KEY_SENDER", "SPONGE_API_KEY_RECEIVER"];
let nextId = 0;

async function post(key, payload, sid) {
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-03-26",
  };
  if (sid) headers["Mcp-Session-Id"] = sid;
  const res = await fetch(URL, { method: "POST", headers, body: JSON.stringify(payload) });
  const newSid = res.headers.get("mcp-session-id") ?? res.headers.get("Mcp-Session-Id");
  const text = await res.text();
  const ctype = res.headers.get("content-type") ?? "";
  let body = null;
  if (ctype.includes("text/event-stream")) {
    const dl = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("data:"));
    if (dl) body = JSON.parse(dl.slice(5).trim());
  } else if (text) {
    body = JSON.parse(text);
  }
  return { sid: newSid, body };
}

async function probe(name, key) {
  console.log(`\n=== ${name} ===`);
  if (!key) { console.log("(empty)"); return; }
  const init = await post(key, {
    jsonrpc: "2.0",
    id: ++nextId,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "raw-probe", version: "0.1" } },
  });
  if (init.body?.error) { console.log("init error:", init.body.error.message); return; }
  const sid = init.sid;

  const r = await post(key, {
    jsonrpc: "2.0",
    id: ++nextId,
    method: "tools/call",
    params: { name: "get_balance", arguments: {} },
  }, sid);
  if (r.body?.error) { console.log("get_balance error:", r.body.error.message); return; }

  const txt = r.body?.result?.content?.[0]?.text ?? "(no content)";
  // Pretty-print, but show every chain block.
  try {
    const parsed = JSON.parse(txt);
    for (const [chain, info] of Object.entries(parsed)) {
      const addr = info?.address ?? "?";
      const balances = info?.balances ?? [];
      console.log(`  ${chain.padEnd(10)}  ${addr}  balances=${balances.length}`);
      for (const b of balances) {
        console.log(`              · ${JSON.stringify(b)}`);
      }
    }
  } catch {
    console.log(txt.slice(0, 1000));
  }
}

(async () => {
  console.log(`Sponge raw get_balance dump  ·  endpoint ${URL}`);
  for (const name of KEYS) await probe(name, env[name]);
})().catch((e) => { console.error("crashed:", e.message); process.exit(1); });
