import type { Metadata, Viewport } from "next";
import { Anton, Syne, JetBrains_Mono, Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { LandingChrome } from "@/components/LandingChrome";
import { SharedSigilDefs } from "@/components/marks/SharedSigilDefs";
import { SessionCacheGuard } from "@/components/SessionCacheGuard";
import { ClientErrorReporter } from "@/components/ClientErrorReporter";
import { OnboardingGuide } from "@/components/OnboardingGuide";
import { MotionProvider } from "@/components/MotionProvider";
import { IMAGES } from "@/lib/images";
import { SITE } from "@/lib/site";
import { PwaRegister } from "@/components/PwaRegister";
import { IosViewportLock } from "@/components/ios/IosViewportLock";
import { IosKeyboardRoot } from "@/hooks/useIosKeyboardInset";
import "./globals.css";
import "./ios-native.css";
import "./ios-native-pages.css";
import "./ios-native-nav.css";
import "./ios-native-skin.css";
import "./ios-native-motion.css";
import "./ios-native-command.css";
import "./ios-native-iphone16.css";
import "./ios-native-viewport.css";
import "./ios-native-input-lock.css";
import "./ios-native-tokens.css";
import "./ios-native-organize.css";
import "./ios-native-tab-rail.css";
import "./ios-native-cards.css";

// Self-hosted via next/font (no render-blocking @import, no FOUT/CLS). Variable
// names MUST match tailwind.config fontFamily tokens (--font-anton/-syne/
// -jetbrains/-inter) so the font-anton/font-syne/font-mono/font-display
// utilities keep resolving.
const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-anton",
});
const syne = Syne({
  weight: ["600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-syne",
});
const jetbrainsMono = JetBrains_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains",
});
const inter = Inter({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: `${SITE.name} — ${SITE.tagline}`,
  description: SITE.description,
  alternates: { canonical: SITE.url },
  openGraph: {
    title: SITE.name,
    description: SITE.tagline,
    siteName: SITE.name,
    url: SITE.url,
    images: [
      {
        url: IMAGES.ogImage,
        width: 1200,
        height: 630,
        alt: `${SITE.legalName} Community`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE.name,
    description: SITE.tagline,
    images: [IMAGES.ogImage],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: SITE.name,
    statusBarStyle: "black-translucent",
  },
};

// Next 14: themeColor/viewport must live in a separate `viewport` export, not `metadata`.
export const viewport: Viewport = {
  themeColor: "#040407",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${anton.variable} ${syne.variable} ${jetbrainsMono.variable} ${inter.variable}`}
    >
      <head>
        {/* Warm the connection to Clerk's Frontend API (separate origin) so clerk-js + @clerk/ui
            chunks start loading during HTML parse instead of after hydration — this is what was
            tripping Clerk's "Component renderer did not mount within 10s" watchdog on cold loads.
            Resource hints are behavior-neutral (no-op if unused). */}
        <link rel="preconnect" href="https://clerk.blackouttrades.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://clerk.blackouttrades.com" />
        {/* In-app detection: the iOS app shell (Capacitor) appends "BlackOutiOSApp" to the
            WKWebView user-agent. When present, flag <html> so CSS can hide all pricing /
            purchase UI (App Store guideline 3.1.1 — no external-purchase links in-app).
            Runs during head parse, before paint, so there's no flash of purchase UI. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(/BlackOutiOSApp/.test(navigator.userAgent)){document.documentElement.classList.add('ios-app');var m=document.querySelector('meta[name=viewport]');if(m)m.setAttribute('content','width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover');var cw=Math.min(window.screen.width,window.innerWidth||window.screen.width);if(cw>=430){document.documentElement.classList.add('ios-tier-pro-max')}else if(cw>=393){document.documentElement.classList.add('ios-tier-pro')}var p=location.pathname;if(/^\\/(dashboard|flows|heatmap|terminal|nighthawk|grid|account|faq|learn|upgrade|admin)(\\/|$)/.test(p)){document.documentElement.classList.add('ios-app-pending-shell')}}}catch(e){}",
          }}
        />
      </head>
      <body className="void-bg antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[300] focus:rounded-lg focus:border focus:border-bull/50 focus:bg-black/90 focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:uppercase focus:tracking-[0.2em] focus:text-bull focus:outline-none"
        >
          Skip to content
        </a>
        <SharedSigilDefs />
        {/* @clerk/nextjs v7: the default flipped to STATIC rendering, so opt this tree back into
            per-request (dynamic) auth rendering with `dynamic` — preserving the v5 behavior the
            client nav (useAuth) relies on. v7 also carries the RSC-handshake fix for the soft-nav
            sign-in bounce and clears the GHSA-w24r-5266-9c3c auth-bypass CVE. */}
        <ClerkProvider dynamic>
          <MotionProvider>
            <SessionCacheGuard />
            <ClientErrorReporter />
            <PwaRegister />
            <IosViewportLock />
            <IosKeyboardRoot />
            <LandingChrome />
            <OnboardingGuide />
            {children}
          </MotionProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
