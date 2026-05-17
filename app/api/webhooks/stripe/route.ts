// /api/webhooks/stripe — GONE.
//
// The down-payment rail uses Sponge, not Stripe. Webhook traffic must be
// redirected to /api/webhooks/sponge. This route returns 410 Gone so an
// old Stripe webhook config doesn't silently swallow events.
//
// Replaced by: app/api/webhooks/sponge/route.ts

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
