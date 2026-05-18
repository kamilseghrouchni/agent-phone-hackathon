#!/usr/bin/env node
// Drain the RECEIVER (crovi) Sponge wallet back to the SENDER (agent-hack).
// Reads receiver USDC, transfers the full amount on Solana, verifies zero.
//
// Run:   node scripts/sponge-drain.mjs            (drains full balance)
//        node scripts/sponge-drain.mjs --amount 1.50   (drain a specific amount)
//        node scripts/sponge-drain.mjs --dry-run       (no transfer, just report)

import fs from "fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf-8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).split(" #")[0].trim()]; }),
);

const URL = env.SPONGE_MCP_URL ?? "https://api.wallet.paysponge.com/mcp";
const SENDER_KEY = env.SPONGE_API_KEY_SENDER;
const RECEIVER_KEY = env.SPONGE_API_KEY_RECEIVER ?? env.SPONGE_API_KEY;
const SENDER_ADDRESS = env.SPONGE_WALLET_FROM;
const RECEIVER_ADDRESS = env.SPONGE_WALLET_TO;
const args = process.argv.slice(2);
const FORCED_AMOUNT = args.find((a, i) => args[i-1] === "--amount") ?? null;
const DRY = args.includes("--dry-run");

let nextId = 0;
let session = null;
let currentKey = null;

async function rawPost(payload, isNotify = false) {
  const headers = {
    Authorization: `Bearer ${currentKey}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-03-26",
  };
  if (session) headers["Mcp-Session-Id"] = session;
  const res = await fetch(URL, { method: "POST", headers, body: JSON.stringify(payload) });
  const sid = res.headers.get("mcp-session-id") ?? res.headers.get("Mcp-Session-Id");
  if (sid && !session) session = sid;
  if (isNotify) return null;
  const txt = await res.text();
  const ctype = res.headers.get("content-type") ?? "";
  let body;
  if (ctype.includes("text/event-stream")) {
    const dl = txt.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("data:"));
    if (!dl) throw new Error(`SSE no data: ${txt.slice(0, 200)}`);
    body = JSON.parse(dl.slice(5).trim());
  } else {
    body = JSON.parse(txt);
  }
  if (body.error) throw new Error(`${payload.method}: ${body.error.message} (code ${body.error.code})`);
  return body.result;
}

async function initWith(key) {
  currentKey = key;
  session = null;
  await rawPost({
    jsonrpc: "2.0", id: ++nextId, method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "sponge-drain", version: "0.1" } },
  });
  await rawPost({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, true).catch(() => {});
}

async function call(name, args) {
  const r = await rawPost({ jsonrpc: "2.0", id: ++nextId, method: "tools/call", params: { name, arguments: args } });
  const text = r?.content?.[0]?.text;
  try { return text ? JSON.parse(text) : (r?.structuredContent ?? r); }
  catch { return text; }
}

function fmtUsdc(parsed) {
  const sol = parsed?.solana ?? {};
  const usdc = (sol.balances ?? []).find((b) => /USDC/i.test(b.symbol ?? b.token ?? ""));
  return usdc?.amount ?? usdc?.balance ?? usdc?.value ?? "0";
}

const sep = () => console.log("─".repeat(70));

(async () => {
  console.log(`Sponge drain  ·  RECEIVER (crovi) → SENDER (agent-hack)  ·  chain=solana${DRY ? "  ·  DRY-RUN" : ""}`);
  sep();
  if (!SENDER_KEY || !RECEIVER_KEY || !SENDER_ADDRESS || !RECEIVER_ADDRESS) {
    console.error("Missing env: need SPONGE_API_KEY_SENDER, SPONGE_API_KEY_RECEIVER, SPONGE_WALLET_FROM, SPONGE_WALLET_TO");
    process.exit(1);
  }

  // Pre-balance
  await initWith(RECEIVER_KEY);
  const recvBefore = await call("get_balance", {});
  const recvAddr = recvBefore?.solana?.address;
  const recvUsdcBefore = parseFloat(fmtUsdc(recvBefore));
  console.log(`receiver ${recvAddr}  USDC=${recvUsdcBefore}`);
  await initWith(SENDER_KEY);
  const sendBefore = await call("get_balance", {});
  const sendAddr = sendBefore?.solana?.address;
  const sendUsdcBefore = parseFloat(fmtUsdc(sendBefore));
  console.log(`sender   ${sendAddr}  USDC=${sendUsdcBefore}`);
  sep();

  if (recvAddr !== RECEIVER_ADDRESS) {
    console.error(`receiver wallet (${recvAddr}) doesn't match SPONGE_WALLET_TO (${RECEIVER_ADDRESS}) — aborting`);
    process.exit(1);
  }
  if (sendAddr !== SENDER_ADDRESS) {
    console.error(`sender wallet (${sendAddr}) doesn't match SPONGE_WALLET_FROM (${SENDER_ADDRESS}) — aborting`);
    process.exit(1);
  }

  const amountToMove = FORCED_AMOUNT ?? recvUsdcBefore.toFixed(2);
  if (parseFloat(amountToMove) <= 0) {
    console.log("receiver already empty — nothing to drain.");
    return;
  }
  if (parseFloat(amountToMove) > recvUsdcBefore) {
    console.error(`requested ${amountToMove} but receiver only has ${recvUsdcBefore} USDC — aborting`);
    process.exit(1);
  }

  if (DRY) {
    console.log(`DRY: would transfer ${amountToMove} USDC  from receiver → sender (${SENDER_ADDRESS})`);
    return;
  }

  // Fire transfer using RECEIVER's key — receiver is the implicit sender of this op.
  console.log(`firing transfer  to=${SENDER_ADDRESS}  amount=${amountToMove} USDC`);
  await initWith(RECEIVER_KEY);
  let transferRes;
  try {
    transferRes = await call("transfer", {
      chain: "solana",
      to: SENDER_ADDRESS,
      amount: amountToMove,
      token: "USDC",
    });
  } catch (err) {
    console.error("transfer call failed:", err.message);
    console.error("\nLikely cause: receiver wallet has no SOL for gas.");
    console.error("Fix: deposit ~$0.50 of SOL to", RECEIVER_ADDRESS, "and re-run.");
    process.exit(1);
  }
  console.log("transfer result:", JSON.stringify(transferRes, null, 2).slice(0, 500));
  sep();

  const txHash = transferRes?.txHash ?? transferRes?.tx_hash ?? transferRes?.signature ?? transferRes?.transaction_hash ?? transferRes?.id;
  if (txHash) {
    console.log(`tx hash: ${txHash}`);
    console.log(`solscan: https://solscan.io/tx/${txHash}`);
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        await initWith(RECEIVER_KEY);
        const status = await call("get_transaction_status", { chain: "solana", txHash });
        console.log(`  poll #${i+1}:`, JSON.stringify(status).slice(0, 200));
        if (status?.status && /success|confirmed|finalized|settled/i.test(status.status)) break;
      } catch (e) {
        console.log(`  poll #${i+1} err: ${e.message.slice(0, 100)}`);
      }
    }
    sep();
  }

  // Post-balance
  await initWith(RECEIVER_KEY);
  const recvAfter = parseFloat(fmtUsdc(await call("get_balance", {})));
  await initWith(SENDER_KEY);
  const sendAfter = parseFloat(fmtUsdc(await call("get_balance", {})));
  console.log(`receiver USDC  before=${recvUsdcBefore}  after=${recvAfter}  delta=${(recvAfter - recvUsdcBefore).toFixed(4)}`);
  console.log(`sender   USDC  before=${sendUsdcBefore}  after=${sendAfter}  delta=${(sendAfter - sendUsdcBefore).toFixed(4)}`);
  sep();
  if (recvAfter <= 0.0001) {
    console.log(`✓ receiver drained — crovi wallet is now empty for the demo`);
  } else {
    console.log(`⚠ receiver still has ${recvAfter} USDC — tx may still be propagating, or transfer didn't fully settle`);
  }
})().catch((e) => { console.error("crashed:", e.message); process.exit(1); });
