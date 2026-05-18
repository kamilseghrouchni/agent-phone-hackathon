#!/usr/bin/env node
// Map every Sponge API key in .env.local → wallet address + balance.
// Read-only. No funds moved. Use this to figure out which key is which.

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

// Every key var that looks like it could be a Sponge auth key.
const CANDIDATE_KEYS = [
  "SPONGE_API_KEY",
  "SPONGE_API_KEY_CROVI",
  "SPONGE_API_KEY_HACKATHON",
  "SPONGE_API_HACKATHON",
];

let nextId = 0;

async function callOnce(key, payload) {
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-03-26",
  };
  const res = await fetch(URL, { method: "POST", headers, body: JSON.stringify(payload) });
  const sid = res.headers.get("mcp-session-id") ?? res.headers.get("Mcp-Session-Id");
  const text = await res.text();
  const ctype = res.headers.get("content-type") ?? "";
  let body;
  if (ctype.includes("text/event-stream")) {
    const dl = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("data:"));
    body = dl ? JSON.parse(dl.slice(5).trim()) : null;
  } else {
    body = text ? JSON.parse(text) : null;
  }
  return { sid, body };
}

async function probeKey(key) {
  // 1) initialize → grab session id
  const initRes = await callOnce(key, {
    jsonrpc: "2.0",
    id: ++nextId,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "sponge-keymap", version: "0.1.0" },
    },
  });
  if (initRes.body?.error) throw new Error(initRes.body.error.message);
  const sessionId = initRes.sid;

  // 2) tools/call get_balance with session header
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-03-26",
      "Mcp-Session-Id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++nextId,
      method: "tools/call",
      params: { name: "get_balance", arguments: {} },
    }),
  });
  const text = await res.text();
  const ctype = res.headers.get("content-type") ?? "";
  let body;
  if (ctype.includes("text/event-stream")) {
    const dl = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("data:"));
    body = dl ? JSON.parse(dl.slice(5).trim()) : null;
  } else {
    body = text ? JSON.parse(text) : null;
  }
  if (body?.error) throw new Error(body.error.message);
  const txt = body?.result?.content?.[0]?.text ?? "{}";
  let parsed = {};
  try { parsed = JSON.parse(txt); } catch {}
  return parsed;
}

(async () => {
  console.log("Sponge key→wallet map (read-only, no funds moved)");
  console.log("─".repeat(80));
  console.log(`${"env var".padEnd(28)}  ${"solana address".padEnd(46)}  USDC`);
  console.log("─".repeat(80));

  for (const name of CANDIDATE_KEYS) {
    const key = env[name];
    if (!key) {
      console.log(`${name.padEnd(28)}  (empty)`);
      continue;
    }
    try {
      const res = await probeKey(key);
      const sol = res?.solana ?? {};
      const addr = sol.address ?? "?";
      const usdc = (sol.balances ?? []).find((b) => /USDC/i.test(b.symbol ?? ""));
      const usdcAmt = usdc?.amount ?? usdc?.balance ?? usdc?.value ?? "0";
      // Also show all chains in one line so we can see if money is on another chain.
      const chains = Object.entries(res)
        .filter(([k, v]) => v?.address && k !== "solana")
        .map(([k, v]) => {
          const bal = (v.balances ?? []).find((b) => /USDC/i.test(b.symbol ?? "")) ?? (v.balances ?? [])[0];
          const amt = bal?.amount ?? bal?.balance ?? bal?.value;
          return amt ? `${k}=${amt} ${bal?.symbol ?? "?"}` : `${k}=0`;
        })
        .filter((s) => !s.endsWith("=0"))
        .join("  ");
      console.log(`${name.padEnd(28)}  ${addr.padEnd(46)}  ${usdcAmt}${chains ? "  · " + chains : ""}`);
    } catch (err) {
      console.log(`${name.padEnd(28)}  ERROR: ${err.message.slice(0, 50)}`);
    }
  }
  console.log("─".repeat(80));
  console.log("legend: USDC column is Solana USDC; trailing  · base=X / ethereum=Y if funds on other chains");
})().catch((e) => {
  console.error("crashed:", e.message);
  process.exit(1);
});
