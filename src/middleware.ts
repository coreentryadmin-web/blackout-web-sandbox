import type { NextRequest } from "next/server";
import { isCognitoAuth } from "@/lib/auth-provider";
import cognitoMiddleware from "@/middleware-cognito";

/** Inline only — Next.js cannot analyze re-exported middleware config. */
export const config = {
  matcher: [
    {
      source:
        "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
      missing: [{ type: "header", key: "upgrade", value: "websocket" }],
    },
    {
      source: "/(api|trpc)(.*)",
      missing: [{ type: "header", key: "upgrade", value: "websocket" }],
    },
    {
      source: "/__clerk/(.*)",
      missing: [{ type: "header", key: "upgrade", value: "websocket" }],
    },
  ],
};

type MiddlewareFn = (req: NextRequest, event?: unknown) => Response | Promise<Response>;

function loadClerkMiddleware(): MiddlewareFn {
  // Lazy require — omitted from Cognito production bundles when AUTH_PROVIDER is inlined at build.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@/middleware-clerk").default as MiddlewareFn;
}

const handler: MiddlewareFn = isCognitoAuth() ? cognitoMiddleware : loadClerkMiddleware();

export default handler;
