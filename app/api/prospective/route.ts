import { NextResponse } from "next/server";
import { loadProspectiveCards, rankProspective } from "@/lib/prospective";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const cards = loadProspectiveCards();
  const ranked = rankProspective(cards, q);
  return NextResponse.json({ cards: ranked });
}
