# Sponge payment integration — wallet model + transfer mechanics

Captures everything we learned scoping the real wire-up so we don't re-derive it next session.

## TL;DR

For the demo, **Stage 4 (sms+pay)** fires a real Solana USDC transfer from the
"Hackathon agent" wallet to the Crovi receiving wallet via Sponge's MCP. Budget
is $5 USDC; each transfer costs about $0.50 of SOL the first time (a one-time
network cost to create the recipient's USDC account on Solana), then ~$0.001
for every transfer after that.

## The two Sponge accounts

We have two separate Sponge agents. Each agent has its own API key and its own
set of wallet addresses (one per chain).

| Role | env var | Solana address | USDC | SOL |
|---|---|---|---|---|
| Sender (Hackathon agent) | `SPONGE_API_KEY_SENDER` | `7Hc98M…npyi` | $5.00 | $0.87 |
| Receiver (Crovi)         | `SPONGE_API_KEY_RECEIVER` | `4FFJL2…VB6i` | $0    | $0   |

> **Naming gotcha:** these were called `SPONGE_API_KEY_CROVI` and `SPONGE_API_HACKATHON`
> historically — the labels were inverted vs reality. Renamed to `_SENDER` / `_RECEIVER`
> to match the API truth. Old names removed from `.env.local`.

Each agent also has EVM addresses (Base / Ethereum / Arbitrum / Polygon / Tempo /
Monad / Hyperliquid) — they're all the same address per agent because EVM. None
of those are funded right now, so the demo lives on Solana.

`SPONGE_WALLET_FROM` / `SPONGE_WALLET_TO` env vars hold the Solana addresses and
match the agent each key belongs to.

## What "$10.87" on the dashboard actually means

The Sponge dashboard headline for the Hackathon agent is $10.87. Composed of:

```
$5.00  USDC on Solana            ← in wallet, transferable via MCP
$0.87  SOL  on Solana (gas)      ← stays put, fuels transactions
$5.00  USDC on Sponge Card        ← virtual card collateral, NOT directly
                                    transferable through the `transfer` tool
─────
$10.87 dashboard total
```

The `transfer` MCP tool can only move the first two. The Sponge Card $5 is
a separate rail (Visa-style virtual card backed by USDC collateral) — driven
by `issue_virtual_card` / `fund_sponge_card` / `get_card`, not `transfer`.

## MCP wire details (the bits the old code got wrong)

The Sponge MCP server (`https://api.wallet.paysponge.com/mcp`) is a Streamable
HTTP MCP server. Two things the old `sponge.ts` missed:

1. **`initialize` handshake is mandatory.** Every new auth must POST
   `initialize`, capture the `Mcp-Session-Id` response header, then include
   that header on every subsequent `tools/call`. Skipping this returns
   `-32000 Bad Request: No valid session ID provided`. Notification
   `notifications/initialized` should be fired after init.

2. **The transfer tool is named `transfer`, not `wallet.transfer`.** Schema:
   ```
   required: chain, to, amount
   optional: token, token_decimals, data
   example: { chain: "solana", to: "<base58>", amount: "0.10", token: "USDC" }
   ```
   `amount` is human-readable USD-ish (string `"0.10"` not cents).

`get_balance` ignores its `wallet_id` argument and returns the wallet bound to
the API key's agent. To see the receiver's balance you must auth with the
receiver's key.

## Gas mechanics on Solana

- Every USDC transfer needs ~0.000005 SOL for compute (negligible).
- The **first** USDC transfer to a wallet that has never held USDC pays an
  extra ~0.00203 SOL (~$0.18) to create that wallet's Associated Token
  Account (ATA) for USDC. One-time per token type.
- Sponge has a "gas sponsorship" feature but it's **disabled** on this
  account for ATA creation. Confirmed via verbatim error response.
- We sidestepped this by funding the sender with 0.01 SOL (~$0.87).

Once the receiver's USDC ATA is created on the first transfer, subsequent
transfers cost basically nothing. The 0.87 SOL bankroll funds ~370 future
transfers.

## Demo amounts

- Per-transfer demo amount: **$0.50 USDC** (10 demos within the $5 budget,
  enough headroom that one fluffed run doesn't kill the day).
- Configurable via `SPONGE_DEMO_AMOUNT_CENTS` env var (default 50).
- Chain Stage 4 uses this value when wiring the real transfer through
  `lib/integrations/sponge.ts::createDownPayment`.

## Stub mode (fallback)

If `SPONGE_STUB_MODE=true` or any of `SPONGE_API_KEY_SENDER` / `SPONGE_WALLET_FROM`
/ `SPONGE_WALLET_TO` is unset, `createDownPayment` synthesizes a "Funds wired"
event and returns ok:true so the chain still cascades to Stage 5. Useful for
demos in environments without the live Sponge wire.

## What the chain emits on success

When the real transfer settles, the `sms_pay` stage event payload contains:

```
{
  transferId:    "<sponge tx id>",
  txHash:        "<solana signature>",
  solscanUrl:    "https://solscan.io/tx/<signature>",
  amountUsd:     "0.50",
  receiverUsdc:  "<post-transfer balance>",
  mode:          "real"
}
```

The UI's wallet tile + Timeline pull `solscanUrl` and `receiverUsdc` from this
payload for the visible demo beat.

## Reference scripts

- `scripts/probe-sponge-raw.mjs`  — dump every chain × every token for every key
- `scripts/probe-sponge-keys.mjs` — one-line balance per key
- `scripts/sponge-status.mjs`     — plain-English wallet status + unblock paths
- `scripts/sponge-test-transfer.mjs` — fire a real test transfer (gated)
- `scripts/sponge-inspect-transfer.mjs` — dump transfer / submit_plan schemas

All read-only except `sponge-test-transfer.mjs`. Each prints what it's about
to do before doing it.

## Things we intentionally are NOT doing

- No bridging Solana→EVM (would require SOL gas on the bridge call too).
- No Sponge Card minting/spending (separate flow, not on the chain critical
  path).
- No `submit_plan` orchestration (it's just a wrapper around `transfer` —
  inherits the same gas constraints).
- No webhook integration with Sponge (the docs don't ship a webhook spec yet;
  we poll `get_transaction_status` instead).
