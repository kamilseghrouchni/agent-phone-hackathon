"use client";

// components/Chain/WalletTile.tsx — supplier wallet balance tile (spec §6 V5.2).
//
// Shows $0 → $10 transition driven by the Sponge webhook (NOT Revolut — wallet
// tile is the in-app proof). Animates the increment over ~1s using rAF.
//
// Subscribes to /api/wallet/[runId]/[supplierId] SSE for payment_settled events.

import { useEffect, useRef, useState } from "react";

type WalletStatus = "idle" | "pending" | "settled" | "error";

interface PaymentSettledMessage {
  type: "payment_settled" | "payout_started";
  amount_cents: number;
  currency: string;
  transfer_id: string;
  livemode: boolean;
  source: "sponge_webhook" | "manual_fallback";
  at: string;
}

interface WalletTileProps {
  runId: string;
  supplierId: string;
  /** Override the SSE endpoint (testing). Defaults to /api/wallet/{runId}/{supplierId}. */
  endpoint?: string;
  /** Animation duration ms (default 1000 = spec target). */
  animationMs?: number;
  /** Optional className for outer container. */
  className?: string;
}

function formatUsd(cents: number): string {
  // Show whole dollars when round, two decimals otherwise.
  const dollars = cents / 100;
  if (Number.isInteger(dollars)) return `$${dollars}`;
  return `$${dollars.toFixed(2)}`;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function WalletTile({
  runId,
  supplierId,
  endpoint,
  animationMs = 1000,
  className,
}: WalletTileProps) {
  const [status, setStatus] = useState<WalletStatus>("idle");
  const [displayCents, setDisplayCents] = useState(0);
  const [targetCents, setTargetCents] = useState(0);
  const [transferId, setTransferId] = useState<string | null>(null);
  const [source, setSource] = useState<"sponge_webhook" | "manual_fallback" | null>(null);

  const animRef = useRef<number | null>(null);

  // Animate displayCents → targetCents whenever target changes.
  useEffect(() => {
    if (targetCents === displayCents) return;
    const from = displayCents;
    const to = targetCents;
    const start = performance.now();

    const step = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / animationMs);
      const v = Math.round(from + (to - from) * easeOutCubic(t));
      setDisplayCents(v);
      if (t < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        animRef.current = null;
      }
    };
    animRef.current = requestAnimationFrame(step);
    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetCents, animationMs]);

  // Subscribe to wallet SSE stream.
  useEffect(() => {
    if (!runId || !supplierId) return;
    const url = endpoint ?? `/api/wallet/${encodeURIComponent(runId)}/${encodeURIComponent(supplierId)}`;
    let es: EventSource | null = null;
    try {
      es = new EventSource(url);
    } catch {
      setStatus("error");
      return;
    }

    setStatus((prev) => (prev === "idle" ? "pending" : prev));

    const handleSettled = (raw: MessageEvent) => {
      try {
        const msg = JSON.parse(raw.data) as PaymentSettledMessage;
        setTargetCents((prev) => prev + msg.amount_cents);
        setStatus("settled");
        setTransferId(msg.transfer_id);
        setSource(msg.source);
      } catch {
        // malformed — ignore
      }
    };

    es.addEventListener("payment_settled", handleSettled);
    es.addEventListener("payout_started", (e) => {
      // Just surface that a payout is in motion; balance change comes from settled.
      try {
        const msg = JSON.parse((e as MessageEvent).data) as PaymentSettledMessage;
        if (status === "idle") setStatus("pending");
        setSource(msg.source);
      } catch { /* noop */ }
    });
    es.onerror = () => {
      // SSE errors are common (proxy timeouts); leave status as-is and let
      // the browser auto-reconnect.
    };

    return () => {
      es?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, supplierId, endpoint]);

  const displayLabel = formatUsd(displayCents);
  const pulse = status === "settled" && displayCents !== targetCents; // mid-animation

  return (
    <div
      className={`wallet-tile${className ? ` ${className}` : ""}`}
      data-status={status}
      data-supplier={supplierId}
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "12px 14px",
        border: "1px solid var(--border, #2a2a2a)",
        borderRadius: 10,
        background: "var(--card-bg, #0f0f10)",
        color: "var(--card-fg, #f5f5f5)",
        minWidth: 200,
        fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: 1.2,
          opacity: 0.7,
          textTransform: "uppercase",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>Supplier wallet</span>
        <span
          style={{
            fontSize: 9,
            padding: "2px 6px",
            border: "1px solid currentColor",
            borderRadius: 999,
            opacity: status === "settled" ? 1 : 0.5,
          }}
        >
          {status === "settled" ? "settled" : status === "pending" ? "pending" : status === "error" ? "error" : "idle"}
        </span>
      </div>

      <div
        style={{
          fontSize: 36,
          lineHeight: 1.05,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          transition: "color 200ms ease",
          color: status === "settled" ? "var(--accent-good, #4ade80)" : "var(--card-fg, #f5f5f5)",
          textShadow: pulse ? "0 0 12px rgba(74, 222, 128, 0.45)" : "none",
        }}
      >
        {displayLabel}
      </div>

      <div style={{ fontSize: 10, opacity: 0.55, minHeight: 14 }}>
        {transferId
          ? `Sponge ${source === "manual_fallback" ? "(manual)" : ""} ${transferId}`
          : "awaiting transfer.settled webhook"}
      </div>
    </div>
  );
}

export default WalletTile;
