#!/usr/bin/env node
// Plain-English status report: what's provisioned where, what can move, what blocks it.
// Read-only. No funds moved.

import fs from "fs";
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf-8").split("\n")
    .filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i=l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).split(" #")[0].trim()]; }),
);

const URL = env.SPONGE_MCP_URL ?? "https://api.wallet.paysponge.com/mcp";
let nextId = 0, session = null, currentKey = null;

async function post(payload, notify) {
  const h = { Authorization: `Bearer ${currentKey}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26" };
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

async function initWith(key) {
  currentKey = key; session = null;
  await post({ jsonrpc:"2.0", id:++nextId, method:"initialize", params:{ protocolVersion:"2025-03-26", capabilities:{}, clientInfo:{ name:"status", version:"0" }}});
  await post({ jsonrpc:"2.0", method:"notifications/initialized", params:{}}, true).catch(()=>{});
}

async function getBalance(key, label) {
  await initWith(key);
  const r = await post({ jsonrpc:"2.0", id:++nextId, method:"tools/call", params:{ name:"get_balance", arguments:{}}});
  const txt = r?.content?.[0]?.text ?? "{}";
  let parsed = {};
  try { parsed = JSON.parse(txt); } catch {}
  return { label, parsed };
}

(async () => {
  console.log("\n┌─ SPONGE WALLET STATUS REPORT ─────────────────────────────────────┐\n");

  const sender = await getBalance(env.SPONGE_API_KEY_SENDER, "SENDER (env SPONGE_API_KEY_SENDER)");
  const recv = await getBalance(env.SPONGE_API_KEY_RECEIVER, "RECEIVER (env SPONGE_API_KEY_RECEIVER)");

  for (const w of [sender, recv]) {
    console.log(`  ${w.label}`);
    const chains = Object.entries(w.parsed);
    const funded = chains.filter(([, info]) => (info?.balances ?? []).length > 0);
    if (funded.length === 0) {
      // Show the empty addresses anyway so user sees what wallet they're looking at
      for (const [chain, info] of chains.slice(0, 2)) {
        console.log(`    ${chain.padEnd(12)} ${info.address}   (no tokens)`);
      }
      if (chains.length > 2) console.log(`    ...${chains.length - 2} more chains, all empty`);
    } else {
      for (const [chain, info] of chains) {
        const bal = info?.balances ?? [];
        if (bal.length === 0) continue;
        for (const b of bal) {
          const amt = b.amount ?? b.balance ?? b.value;
          const sym = b.token ?? b.symbol;
          const usd = b.usdValue ? `  ≈ $${b.usdValue}` : "";
          console.log(`    ${chain.padEnd(12)} ${info.address}  ${amt} ${sym}${usd}`);
        }
      }
    }
    console.log("");
  }

  console.log("└───────────────────────────────────────────────────────────────────┘\n");

  // Plain-English transfer matrix
  console.log("┌─ WHAT CAN MOVE RIGHT NOW ────────────────────────────────────────┐\n");
  console.log("  Sender wallet holds:");
  const senderTokens = Object.entries(sender.parsed).flatMap(([chain, info]) =>
    (info?.balances ?? []).map(b => ({ chain, amount: b.amount ?? b.balance, token: b.token ?? b.symbol })),
  );
  if (!senderTokens.length) console.log("    (nothing)");
  for (const t of senderTokens) console.log(`    · ${t.amount} ${t.token} on ${t.chain}`);

  console.log("\n  Each chain has its own gas rule:");
  console.log("    · Solana  — every transfer needs SOL gas. Sender has 0 SOL.");
  console.log("    · Base / Ethereum / Arbitrum / Polygon — need native gas token (ETH/MATIC). Sender has 0.");
  console.log("    · Tempo   — USDC pays its own gas. Sender has 0 USDC on Tempo.");
  console.log("    · Monad / Hyperliquid — empty too.");

  console.log("\n  Transfer paths that COULD work right now (none currently):");
  console.log("    ✗ Solana USDC → receiver Solana addr   (blocked: no SOL gas)");
  console.log("    ✗ Base USDC → receiver Base addr        (blocked: no USDC on Base)");
  console.log("    ✗ Tempo USDC → receiver Tempo addr      (blocked: no USDC on Tempo)");

  console.log("\n  To unblock you need ONE of:");
  console.log("    1. ~$0.50 of SOL deposited to the Solana sender address");
  console.log("       (then $5 USDC moves to receiver freely)");
  console.log("    2. Enable 'gas sponsorship' in your Sponge dashboard");
  console.log("       (Sponge says it's currently disabled for this account)");
  console.log("    3. Re-receive your hackathon credit on Tempo or Base directly");
  console.log("       (Tempo USDC pays its own gas)");
  console.log("\n└───────────────────────────────────────────────────────────────────┘\n");

  console.log("ADDRESSES (for funding any of the above):");
  for (const w of [sender, recv]) {
    const sol = w.parsed.solana?.address;
    const evm = w.parsed.base?.address;
    console.log(`  ${w.label.split(" ")[0]}`);
    console.log(`    Solana: ${sol}`);
    console.log(`    EVM:    ${evm}   (same on Base / Ethereum / Arbitrum / Polygon / Tempo)`);
  }
})().catch(e => { console.error("crashed:", e.message); process.exit(1); });
