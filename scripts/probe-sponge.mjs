#!/usr/bin/env node
// Sponge wire probe — read-only. Validates auth, discovers tool surface,
// reads balances on both configured wallets. NO fund movement.
// Run: node scripts/probe-sponge.mjs

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
// Two-key model — the API key determines which wallet you talk to. The receiver
// key reads its own balance + admin views; the sender key signs transfers.
const KEY_RECEIVER = env.SPONGE_API_KEY_CROVI ?? env.SPONGE_API_KEY;
const KEY_SENDER = env.SPONGE_API_KEY_HACKATHON ?? env.SPONGE_API_HACKATHON;
const FROM = env.SPONGE_WALLET_FROM;
const TO = env.SPONGE_WALLET_TO;

let nextId = 0;
let sessionId = null;
let currentKey = null;

function parseBody(res, text) {
  const ctype = res.headers.get("content-type") ?? "";
  if (ctype.includes("text/event-stream")) {
    const dataLine = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("data:"));
    if (!dataLine) throw new Error(`SSE no data: ${text.slice(0, 200)}`);
    return JSON.parse(dataLine.slice(5).trim());
  }
  return JSON.parse(text);
}

async function rawPost(payload, isNotification = false) {
  const headers = {
    Authorization: `Bearer ${currentKey}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-03-26",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetch(URL, { method: "POST", headers, body: JSON.stringify(payload) });
  // Capture session id when the server hands us one (on initialize).
  const newSid = res.headers.get("mcp-session-id") ?? res.headers.get("Mcp-Session-Id");
  if (newSid && !sessionId) sessionId = newSid;
  if (isNotification) return null;
  const text = await res.text();
  const body = parseBody(res, text);
  if (body.error) throw new Error(`${payload.method}: ${body.error.message} (code ${body.error.code})`);
  return body.result;
}

async function mcp(method, params = {}) {
  return rawPost({ jsonrpc: "2.0", id: ++nextId, method, params });
}

async function initialize(key) {
  currentKey = key;
  sessionId = null; // fresh session per key
  const result = await rawPost({
    jsonrpc: "2.0",
    id: ++nextId,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "sponge-probe", version: "0.1.0" },
    },
  });
  // Required per spec — fire-and-forget notification telling the server we're ready.
  await rawPost({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, true).catch(() => {});
  return result;
}

const line = (s = "") => console.log(s);
const sep = () => line("─".repeat(60));

async function probeKey(label, key, expectedAddress) {
  if (!key) {
    line(`${label}  KEY MISSING — skipping`);
    return null;
  }
  await initialize(key);
  // Read this key's own wallet via get_balance (server ignores wallet_id arg
  // and returns the wallet bound to the API key).
  const r = await mcp("tools/call", { name: "get_balance", arguments: {} });
  let parsed = null;
  try {
    parsed = JSON.parse(r?.content?.[0]?.text ?? "{}");
  } catch {
    parsed = null;
  }
  const sol = parsed?.solana ?? {};
  const usdc = (sol.balances ?? []).find((b) => /USDC/i.test(b.symbol ?? b.token ?? ""));
  const usdcAmt = usdc ? (usdc.amount ?? usdc.balance ?? usdc.value) : "0";
  const addressMatch = expectedAddress ? sol.address === expectedAddress : null;
  line(`${label}  solana=${sol.address ? sol.address.slice(0, 6) + "…" + sol.address.slice(-4) : "?"}` +
       `  USDC=${usdcAmt}` +
       (addressMatch === true ? "  ✓ matches env" : addressMatch === false ? "  ⚠ env mismatch" : ""));
  return { address: sol.address, balances: sol.balances ?? [], usdc: usdcAmt };
}

(async () => {
  line("Sponge wire probe — read-only, no funds moved");
  sep();
  line(`endpoint                       ${URL}`);
  line(`SPONGE_API_KEY_CROVI (recv)    ${KEY_RECEIVER ? "set len=" + KEY_RECEIVER.length : "MISSING"}`);
  line(`SPONGE_API_KEY_HACKATHON (snd) ${KEY_SENDER ? "set len=" + KEY_SENDER.length : "MISSING"}`);
  line(`SPONGE_WALLET_FROM             ${FROM ? FROM.slice(0, 6) + "…" + FROM.slice(-4) : "MISSING"}`);
  line(`SPONGE_WALLET_TO               ${TO ? TO.slice(0, 6) + "…" + TO.slice(-4) : "MISSING"}`);
  sep();

  if (!KEY_RECEIVER) {
    line("✗ NOT READY — receiver key missing");
    process.exit(1);
  }

  // Probe receiver
  line("Receiver wallet (Crovi):");
  const recv = await probeKey("  ", KEY_RECEIVER, TO);

  // Probe sender
  line("Sender wallet (Hackathon):");
  const send = await probeKey("  ", KEY_SENDER, FROM);
  sep();

  // Discover the `transfer` tool's exact schema so we know how to call it.
  await initialize(KEY_SENDER ?? KEY_RECEIVER);
  const tl = await mcp("tools/list", {});
  const transferTool = (tl.tools ?? []).find((t) => t.name === "transfer");
  if (transferTool) {
    line(`transfer tool input schema:`);
    line(`  required: ${JSON.stringify(transferTool.inputSchema?.required ?? [])}`);
    const props = transferTool.inputSchema?.properties ?? {};
    for (const [k, v] of Object.entries(props).slice(0, 12)) {
      line(`    · ${k}: ${v.type ?? v.enum?.join("|") ?? "any"}${v.description ? "  — " + v.description.slice(0, 60) : ""}`);
    }
  } else {
    line(`⚠ transfer tool not found in tools/list`);
  }
  sep();

  // Readiness verdict
  const senderUsdc = parseFloat(send?.usdc ?? "0");
  const checks = [
    ["receiver key works", !!recv?.address],
    ["sender key works", !!send?.address],
    ["sender owns FROM address", send?.address === FROM],
    ["receiver owns TO address", recv?.address === TO],
    ["sender has USDC balance", senderUsdc > 0],
    ["transfer tool discovered", !!transferTool],
  ];
  for (const [k, ok] of checks) line(`${ok ? "✓" : "✗"} ${k}`);

  const allOk = checks.every(([, ok]) => ok);
  sep();
  line(allOk ? "✓ READY — sender + receiver wired, transfer tool present, no funds moved"
             : "✗ NOT READY — see ✗ rows above");

  if (allOk) {
    line("");
    line("To simulate the actual transfer (NO funds yet — dry plan):");
    line(`  amount:   $0.10 USDC (or whatever the chain quotes)`);
    line(`  from:     ${FROM}`);
    line(`  to:       ${TO}`);
    line(`  auth:     SPONGE_API_KEY_HACKATHON`);
    line(`  tool:     transfer (chain=solana, currency=USDC)`);
  }
})().catch((e) => {
  console.error("probe crashed:", e.message);
  process.exit(1);
});
