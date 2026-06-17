import { NextResponse } from "next/server";
import { buildSpxDesk } from "@/lib/providers/spx-desk";

export async function GET() {
  try {
    const desk = await buildSpxDesk();
    return NextResponse.json(desk);
  } catch (error) {
    console.error("[market/spx/desk]", error);
    return NextResponse.json({ available: false, error: "Desk build failed" }, { status: 502 });
  }
}
