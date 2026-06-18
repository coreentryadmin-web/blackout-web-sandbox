import Link from "next/link";
import { UwEndpointTable } from "@/components/docs/UwEndpointTable";
import {
  UW_BLACKOUT_ENDPOINT_COUNT,
  UW_DOCS_BASE,
  UW_DOCS_URL,
  UW_ENDPOINT_TOTAL,
  UW_REST_SECTIONS,
  UW_REST_TOC,
} from "@/lib/uw-docs-catalog";

export const revalidate = 0;

export default function UnusualWhalesEndpointsPage() {
  return (
    <main className="docs-page-main docs-ref-main">
      <header className="docs-header">
        <p className="docs-kicker">REST API · Unusual Whales</p>
        <h1 className="docs-title">All REST Endpoints</h1>
        <p className="docs-lead">
          {UW_ENDPOINT_TOTAL} endpoints across 32 categories — synced from the official UW docs index. Endpoints
          marked <span className="docs-badge docs-badge-uw">BlackOut</span> are used or referenced in our codebase (
          {UW_BLACKOUT_ENDPOINT_COUNT} total).
        </p>
        <Link href="/docs/unusual-whales" className="docs-back-link">
          ← UW docs index
        </Link>
        <a href={UW_DOCS_URL} target="_blank" rel="noopener noreferrer" className="docs-download-link">
          Official docs ↗
        </a>
      </header>

      <section className="docs-section">
        <h2>Regenerate catalog</h2>
        <pre className="docs-code">{`# Refresh from official index (saved to scripts/uw-docs-index.md)
curl.exe -sL "${UW_DOCS_URL}" -o scripts/uw-docs-index.md
node scripts/generate-uw-docs-catalog.mjs

# Per-endpoint detail (operation ID from table below)
curl -H "Accept: text/plain" ${UW_DOCS_BASE}/docs/operations/PublicApi.MarketController.market_tide`}</pre>
      </section>

      <section className="docs-section">
        <h2>Jump to category</h2>
        <nav className="docs-rest-toc" aria-label="UW endpoint categories">
          {UW_REST_TOC.map((item) => (
            <a key={item.id} href={`#${item.id}`} className="docs-rest-toc-link">
              {item.title}
              <span className="docs-rest-toc-count">{item.count}</span>
            </a>
          ))}
        </nav>
      </section>

      <UwEndpointTable sections={UW_REST_SECTIONS} />
    </main>
  );
}
