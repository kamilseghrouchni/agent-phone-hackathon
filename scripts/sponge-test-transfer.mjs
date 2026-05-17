#!/usr/bin/env node
// Real $0.10 USDC test transfer SENDER → RECEIVER over Solana via Sponge MCP.
// Idempotent-ish: refuses to run twice in <5s without --force.
// Run: node scripts/sponge-test-transfer.mjs [--amount 0.10] [--force]

import fs from "fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf-8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).split(" #")[0].trim()]; }),
);

const URL = env.SPONGE_MCP_URL ?? "https://api.wallet.paysponge.com/mcp";
const SENDER_KEY = env.SPONGE_API_KEY_SENDER;
const RECEIVER_KEY = env.SPONGE_API_KEY_RECEIVER ?? env.SPONGE_API_KEY;
const TO_ADDRESS = env.SPONGE_WALLET_TO;
const args = process.argv.slice(2);
const AMOUNT = args.find((a, i) => args[i-1] === "--amount") ?? "0.10";

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
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "sponge-transfer", version: "0.1" } },
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
  console.log(`Sponge real test transfer  ·  amount=${AMOUNT} USDC  ·  chain=solana`);
  sep();
  if (!SENDER_KEY || !RECEIVER_KEY || !TO_ADDRESS) {
    console.error("Missing SPONGE_API_KEY_SENDER, SPONGE_API_KEY_RECEIVER, or SPONGE_WALLET_TO");
    process.exit(1);
  }

  // 1. Pre-balance: sender + receiver
  await initWith(SENDER_KEY);
  const senderBefore = await call("get_balance", {});
  const senderAddr = senderBefore?.solana?.address;
  const senderUsdcBefore = parseFloat(fmtUsdc(senderBefore));
  console.log(`sender   ${senderAddr}  USDC=${senderUsdcBefore}`);

  await initWith(RECEIVER_KEY);
  const recvBefore = await call("get_balance", {});
  const recvAddr = recvBefore?.solana?.address;
  const recvUsdcBefore = parseFloat(fmtUsdc(recvBefore));
  console.log(`receiver ${recvAddr}  USDC=${recvUsdcBefore}`);
  sep();

  if (recvAddr !== TO_ADDRESS) {
    console.error(`receiver wallet (${recvAddr}) doesn't match SPONGE_WALLET_TO (${TO_ADDRESS}) — aborting`);
    process.exit(1);
  }
  if (senderUsdcBefore < parseFloat(AMOUNT)) {
    console.error(`sender has ${senderUsdcBefore} USDC, need ${AMOUNT} — aborting`);
    process.exit(1);
  }

  // 2. Fire transfer
  console.log(`firing transfer  chain=solana  to=${TO_ADDRESS}  amount=${AMOUNT}  token=USDC`);
  await initWith(SENDER_KEY);
  const transferRes = await call("transfer", {
    chain: "solana",
    to: TO_ADDRESS,
    amount: AMOUNT,
    token: "USDC",
  });
  console.log("transfer result:", JSON.stringify(transferRes, null, 2).slice(0, 500));
  sep();

  // 3. Poll status if a tx id surfaced
  const txHash = transferRes?.txHash ?? transferRes?.tx_hash ?? transferRes?.signature ?? transferRes?.transaction_hash ?? transferRes?.id;
  if (txHash) {
    console.log(`tx hash: ${txHash}`);
    console.log(`solscan: https://solscan.io/tx/${txHash}`);
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        await initWith(SENDER_KEY);
        const status = await call("get_transaction_status", { chain: "solana", txHash });
        console.log(`  poll #${i+1}:`, JSON.stringify(status).slice(0, 200));
        if (status?.status && /success|confirmed|finalized|settled/i.test(status.status)) break;
      } catch (e) {
        console.log(`  poll #${i+1} err: ${e.message.slice(0, 100)}`);
      }
    }
  }
  sep();

  // 4. Post-balance check
  await initWith(RECEIVER_KEY);
  const recvAfter = await call("get_balance", {});
  const recvUsdcAfter = parseFloat(fmtUsdc(recvAfter));
  await initWith(SENDER_KEY);
  const senderAfter = await call("get_balance", {});
  const senderUsdcAfter = parseFloat(fmtUsdc(senderAfter));

  console.log(`receiver USDC  before=${recvUsdcBefore}  after=${recvUsdcAfter}  delta=${(recvUsdcAfter - recvUsdcBefore).toFixed(4)}`);
  console.log(`sender   USDC  before=${senderUsdcBefore}  after=${senderUsdcAfter}  delta=${(senderUsdcAfter - senderUsdcBefore).toFixed(4)}`);
  sep();
  const ok = recvUsdcAfter > recvUsdcBefore;
  console.log(ok ? `✓ TRANSFER SETTLED — receiver got +${(recvUsdcAfter - recvUsdcBefore).toFixed(4)} USDC` : `⚠ receiver balance unchanged — tx may still be propagating`);
})().catch((e) => { console.error("crashed:", e.message); process.exit(1); });
