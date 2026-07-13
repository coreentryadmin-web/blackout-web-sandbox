import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Stub — Cognito staging builds alias @/middleware-clerk here so Clerk is not bundled. */
export default function clerkMiddlewareStub(_req: NextRequest) {
  return NextResponse.next();
}
