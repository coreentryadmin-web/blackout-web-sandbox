import type { CapacitorConfig } from "@capacitor/cli";

/**
 * BlackOut iOS shell.
 *
 * MODEL: this is a thin native wrapper that loads the LIVE production site
 * (server.url) in a WKWebView. Content updates whenever the website deploys —
 * no App Store resubmission needed for normal changes. Native value (required so
 * Apple doesn't reject as a bare wrapper under guideline 4.2) is added via the
 * push-notifications, status-bar, splash-screen plugins + a biometric gate
 * (added in the Xcode/native phase — see README).
 *
 * PAYMENTS: app is sign-in only (Netflix/Spotify model). Users subscribe on the
 * website/Whop; the app never sells or links to checkout in-app. This keeps it
 * App Store compliant AND avoids Apple's 15–30% IAP cut. Do NOT add purchase
 * links or upsell CTAs inside the app surface.
 */
const config: CapacitorConfig = {
  // Capacitor rejects hyphens (Java package rules). Apple ASC bundle is
  // com.blackout-trades.app — patched in Xcode via scripts/patch-ios-bundle-id.mjs.
  appId: "com.blackouttrades.app",
  appName: "BlackOut",
  // Appended to the WKWebView user-agent so the web app can detect it's running
  // INSIDE the iOS app and hide all pricing / purchase UI (App Store guideline
  // 3.1.1 — no external-purchase links in-app). The web app keys off this exact
  // token; do not change it without updating the web app detection.
  appendUserAgent: "BlackOutiOSApp",
  // Required by Capacitor even when using server.url. Holds the offline fallback
  // shell (www/index.html) shown if the device is offline before first load.
  webDir: "www",
  server: {
    // Load the live web app. Comment this block out to instead bundle a local
    // build into www/ (not recommended here — the app is SSR + realtime).
    url: "https://blackouttrades.com",
    cleartext: false,
    // Domains the WKWebView is allowed to navigate to without bouncing to an
    // external browser. Clerk auth + Cloudflare Turnstile + TradingView + Whop
    // must be allow-listed or sign-in / charts / checkout break.
    allowNavigation: [
      "blackouttrades.com",
      "*.blackouttrades.com",
      "clerk.blackouttrades.com",
      "*.clerk.accounts.dev",
      "challenges.cloudflare.com",
      "*.tradingview.com",
      "s.tradingview.com",
      "*.whop.com",
    ],
  },
  ios: {
    // Dark app background to match the site's #040407 void so there's no white
    // flash between splash and first paint.
    backgroundColor: "#040407",
    contentInset: "always",
    // Allow the WKWebView to play inline media without forcing fullscreen.
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#040407",
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
