import { Nav } from "@/components/Nav";

/**
 * Transparent route group — does NOT affect URLs. Hoists the shared <Nav />
 * (a position:fixed banner) so the ~dozen in-app pages no longer each import +
 * render it. Pages keep their own wrapper/backdrop chrome; Nav being pinned to
 * the viewport means its position in the tree is layout-neutral.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      {children}
    </>
  );
}
