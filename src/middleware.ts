import { isCognitoAuth } from "@/lib/auth-provider";
import clerkMiddleware from "@/middleware-clerk";
import cognitoMiddleware from "@/middleware-cognito";

const handler = isCognitoAuth() ? cognitoMiddleware : clerkMiddleware;

export default handler;

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
