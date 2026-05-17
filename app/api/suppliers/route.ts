import { NextResponse } from "next/server";
import { SUPPLIERS } from "@/lib/data/suppliers";

export async function GET() {
  return NextResponse.json({ suppliers: SUPPLIERS });
}
