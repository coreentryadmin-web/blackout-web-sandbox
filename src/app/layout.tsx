import type { Metadata, Viewport } from "next";
import { Anton, Syne, JetBrains_Mono, Inter, Bebas_Neue } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { LandingChrome } from "@/components/LandingChrome";
import { SharedSigilDefs } from "@/components/marks/SharedSigilDefs";
import { SessionCacheGuard } from "@/components/SessionCacheGuard";
import { OnboardingGuide } from "@/components/OnboardingGuide";
import { MotionProvider } from "@/components/MotionProvider";
import { IMAGES } from "@/lib/images";
import { SITE } from "@/lib/site";
import { PwaRegister } from "@/components/PwaRegister";
import "./globals.css";

// Self-hosted via next/font (no render-blocking @import, no FOUT/CLS). Variable
// names MUST match tailwind.config fontFamily tokens (--font-anton/-syne/
// -jetbrains/-inter/-bebas) so the font-anton/font-syne/font-mono/font-display
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
const bebas = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bebas",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: `${SITE.name} — ${SITE.tagline}`,
  description: SITE.description,
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
      className={`${anton.variable} ${syne.variable} ${jetbrainsMono.variable} ${inter.variable} ${bebas.variable}`}
    >
      <body className="void-bg antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[300] focus:rounded-lg focus:border focus:border-bull/50 focus:bg-black/90 focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:uppercase focus:tracking-[0.2em] focus:text-bull focus:outline-none"
        >
          Skip to content
        </a>
        <SharedSigilDefs />
        <ClerkProvider>
          <MotionProvider>
            <SessionCacheGuard />
            <PwaRegister />
            <LandingChrome />
            <OnboardingGuide />
            {children}
          </MotionProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
