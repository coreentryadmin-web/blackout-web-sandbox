import type { Metadata, Viewport } from "next";
import { Anton, Syne, Inter } from "next/font/google";
import { IMAGES } from "@/lib/images";
import { SITE } from "@/lib/site";

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
const inter = Inter({
  weight: ["400", "500", "600"],
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
    images: [{ url: IMAGES.ogImage, width: 1200, height: 630, alt: `${SITE.legalName} Community` }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE.name,
    description: SITE.tagline,
    images: [IMAGES.ogImage],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: SITE.name, statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#040407",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${anton.variable} ${syne.variable} ${inter.variable}`}>
      <head>
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
        {children}
      </body>
    </html>
  );
}
