/**
 * Public marketing surface — lean CSS only (~8KB base + CTA styles, not full globals).
 */
import "../marketing-base.css";
import "../marketing.css";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
