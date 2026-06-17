import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { anthropicConfigured } from "@/lib/providers/anthropic";
import { generateSpxCommentary } from "@/lib/providers/spx-commentary";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!anthropicConfigured()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 503 }
    );
  }

  try {
    const body = (await req.json()) as {
      desk?: SpxDeskPayload;
      previous?: Partial<SpxDeskPayload> | null;
    };

    if (!body.desk?.available || !body.desk.price) {
      return NextResponse.json({ error: "Desk data required" }, { status: 400 });
    }

    const commentary = await generateSpxCommentary(body.desk, body.previous ?? null);
    if (!commentary) {
      return NextResponse.json({ error: "Commentary generation failed" }, { status: 502 });
    }

    return NextResponse.json({ commentary });
  } catch (error) {
    console.error("[market/spx/commentary]", error);
    return NextResponse.json({ error: "Commentary failed" }, { status: 500 });
  }
}
