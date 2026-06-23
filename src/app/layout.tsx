import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { LandingChrome } from "@/components/LandingChrome";
import { SessionCacheGuard } from "@/components/SessionCacheGuard";
import { MotionProvider } from "@/components/MotionProvider";
import { IMAGES } from "@/lib/images";
import { SITE } from "@/lib/site";
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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="void-bg antialiased">
        <ClerkProvider>
          <MotionProvider>
            <SessionCacheGuard />
            <LandingChrome />
            {children}
          </MotionProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
