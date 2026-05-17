// /api/webhooks/stripe — GONE.
//
// The down-payment rail was swapped from Stripe to Sponge (YC W26) for the
// YC hackathon demo. Webhook traffic must be redirected to
// /api/webhooks/sponge. This route now returns 410 Gone so an old Stripe
// webhook config doesn't silently swallow events.
//
// Replaced by: app/api/webhooks/sponge/route.ts
// Replaced on: 2026-05-17

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GONE_BODY = {
  ok: false,
  error: "Stripe webhook is gone — payment rail is Sponge now.",
  replacement: "/api/webhooks/sponge",
};

export async function POST() {
  return NextResponse.json(GONE_BODY, { status: 410 });
}

export async function GET() {
  return NextResponse.json(GONE_BODY, { status: 410 });
}
