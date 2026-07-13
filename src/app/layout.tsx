import type { Metadata, Viewport } from "next";
import { Anton, Syne } from "next/font/google";
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
    <html lang="en" className={`${anton.variable} ${syne.variable}`}>
      <head>
        <link rel="preconnect" href={SITE.url} />
        <link rel="dns-prefetch" href={SITE.url} />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(/BlackOutiOSApp/.test(navigator.userAgent)){document.documentElement.classList.add('ios-app');var m=document.querySelector('meta[name=viewport]');if(m)m.setAttribute('content','width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover');var cw=Math.min(window.screen.width,window.innerWidth||window.screen.width);if(cw>=430){document.documentElement.classList.add('ios-tier-pro-max')}else if(cw>=393){document.documentElement.classList.add('ios-tier-pro')}var p=location.pathname;if(/^\\/(dashboard|flows|heatmap|terminal|nighthawk|grid|account|faq|learn|upgrade|admin)(\\/|$)/.test(p)){document.documentElement.classList.add('ios-app-pending-shell')}}}catch(e){}",
          }}
        />
        {/* Mid-deploy chunk-recovery guard: the freshly-served HTML can reference chunk hashes the
            edge hasn't caught up to during a rollout, so a member who loads mid-deploy gets a
            ChunkLoadError + blank page. One-shot guarded reload pulls the correct chunks once the
            deploy settles. Capped (≤3 reloads, ≥8s apart, via sessionStorage) so a persistent
            failure can't loop. Pattern mirrors `@/lib/chunk-reload` (CHUNK_ERROR_PATTERN_SOURCE),
            kept in sync by chunk-reload.test.ts. Inline in <head> so it catches failures that occur
            before React hydrates. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var RE=/ChunkLoadError|Loading chunk [0-9]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Refused to execute script|Importing a module script failed/i;var K='blackout:chunk-reload';function reload(){try{var raw=sessionStorage.getItem(K);var st=raw?JSON.parse(raw):{n:0,t:0};var now=Date.now();if(st.n>=3||now-st.t<8000)return;sessionStorage.setItem(K,JSON.stringify({n:st.n+1,t:now}))}catch(e){}location.reload()}window.addEventListener('error',function(e){try{var t=e&&e.target;if(t&&(t.tagName==='SCRIPT'||t.tagName==='LINK')&&/_next\\/static\\/chunks\\//.test(t.src||t.href||'')){reload();return}if(e&&RE.test(String(e.message||''))){reload()}}catch(_){}},true);window.addEventListener('unhandledrejection',function(e){try{var r=e&&e.reason;if(r&&RE.test(String(r&&r.message||r||''))){reload()}}catch(_){}})}catch(e){}})();",
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
