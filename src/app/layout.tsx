import type { Metadata, Viewport } from "next";
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
    <html lang="en">
      <body className="void-bg antialiased">
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
