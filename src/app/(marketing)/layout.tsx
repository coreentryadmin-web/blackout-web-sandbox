/**
 * Public marketing surface — no app Nav, market pulse, or iOS desk chrome.
 * marketing.css adds landing CTA styles (core bundle still from root globals).
 */
import "../marketing.css";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
