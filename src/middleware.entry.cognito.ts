/**
 * Staging Cognito-only middleware entry — copied over middleware.ts in Docker when
 * AUTH_PROVIDER=cognito so Clerk is never bundled into the edge middleware.
 */
export { default } from "@/middleware-cognito";

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
  ],
};
