import { auth } from "@clerk/nextjs/server";
import { Nav } from "@/components/Nav";
import { isAdminUser } from "@/lib/admin-access";
import { lockedToolKeys, type ToolKey } from "@/lib/tool-access";

/**
 * Transparent route group — does NOT affect URLs. Hoists the shared <Nav />
 * (a position:fixed banner) so the ~dozen in-app pages no longer each import +
 * render it. Pages keep their own wrapper/backdrop chrome; Nav being pinned to
 * the viewport means its position in the tree is layout-neutral.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // Launch-gate the nav padlocks. Show them ONLY to signed-in, non-admin (paid) users: signed-out
  // visitors see the full showcase (marketing/conversion), admins see everything exactly as today.
  // auth() is cheap; the one getUser (isAdminUser) runs only for signed-in users, and this layout
  // renders once per app-shell entry (preserved across soft-navs), not per page. The page + API
  // gates are the real access boundary — this is cosmetic, so it fails open.
  let lockedTools: ToolKey[] = [];
  try {
    const { userId } = await auth();
    if (userId && !(await isAdminUser(userId))) lockedTools = lockedToolKeys();
  } catch {
    lockedTools = [];
  }

  return (
    <>
      <Nav lockedTools={lockedTools} />
      {children}
    </>
  );
}
