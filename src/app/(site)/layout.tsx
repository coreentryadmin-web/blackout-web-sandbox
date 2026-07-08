import { auth } from "@clerk/nextjs/server";
import { Nav } from "@/components/Nav";
import { IosAppChrome } from "@/components/ios/IosAppChrome";
import { IosNativePageTransition } from "@/components/ios/IosNativePageTransition";
import { IosAppTabBar } from "@/components/IosAppTabBar";
import { MarketSessionProvider } from "@/components/platform/MarketSessionProvider";
import { MarketPulseLayer } from "@/components/platform/MarketPulseLayer";
import { isAdminUser } from "@/lib/admin-access";
import { lockedToolKeys, type ToolKey } from "@/lib/tool-access";
import { AppShellProviders } from "@/components/providers/AppShellProviders";
import "../globals.css";
import "../desk-app.css";
import "../ios-native.css";
import "../ios-native-pages.css";
import "../ios-native-nav.css";
import "../ios-native-skin.css";
import "../ios-native-motion.css";
import "../ios-native-command.css";
import "../ios-native-iphone16.css";
import "../ios-native-viewport.css";
import "../ios-native-input-lock.css";
import "../ios-native-tokens.css";
import "../ios-native-organize.css";
import "../ios-native-tab-rail.css";
import "../ios-native-cards.css";

/**
 * Transparent route group — does NOT affect URLs. Hoists the shared <Nav />
 * (a position:fixed banner) so the ~dozen in-app pages no longer each import +
 * render it. Pages keep their own wrapper/backdrop chrome; Nav being pinned to
 * the viewport means its position in the tree is layout-neutral.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // Launch-gate the nav padlocks. Show them ONLY to signed-in, non-admin (paid) users: signed-out
  // visitors see the full showcase (marketing/conversion), admins see everything exactly as today.
  // auth() is cheap; the one getUser (isAdminUser) runs only for signed-in users, and this layout
  // renders once per app-shell entry (preserved across soft-navs), not per page. The page + API
  // gates are the real access boundary — this is cosmetic, so it fails open.
  let lockedTools: ToolKey[] = [];
  try {
    const { userId } = await auth();
    if (userId && !(await isAdminUser(userId))) lockedTools = lockedToolKeys();
  } catch {
    lockedTools = [];
  }

  return (
    <AppShellProviders>
      {/* VITALS Phase 1 — one shared market-cadence heartbeat behind all in-app
          content. Mounted ONCE here in the real shared (site) layout that wraps
          every product page. MarketPulseLayer is a fixed, pointer-events-none,
          z-index:0 backdrop (behind page content, which sits at z-10), and
          MarketSessionProvider is a client side-effect that publishes the
          --pulse-* cadence vars onto <html>. Both sit before <Nav> so they
          render behind the fixed nav banner and all page chrome. */}
      <MarketSessionProvider />
      <MarketPulseLayer />
      <Nav lockedTools={lockedTools} />
      <IosAppChrome lockedTools={lockedTools} />
      <IosAppTabBar lockedTools={lockedTools} />
      <IosNativePageTransition>{children}</IosNativePageTransition>
    </AppShellProviders>
  );
}
