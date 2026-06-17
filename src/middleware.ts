import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isClerkRoute = createRouteMatcher(["/__clerk(.*)"]);
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/flows(.*)",
  "/terminal(.*)",
  "/heatmap(.*)",
  "/nighthawk(.*)",
  "/api/checkout(.*)",
]);

const proxyUrl =
  process.env.NEXT_PUBLIC_CLERK_PROXY_URL ?? "https://blackouttrades.com/__clerk";

export default clerkMiddleware(
  (auth, req) => {
    if (isClerkRoute(req)) return;
    if (isProtectedRoute(req)) {
      auth().protect();
    }
  },
  { proxyUrl }
);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
