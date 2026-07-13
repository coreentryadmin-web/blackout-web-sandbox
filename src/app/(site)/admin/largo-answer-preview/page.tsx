import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-access";
import { LargoAnswerPreview } from "@/features/largo/answer/LargoAnswerPreview";

export const metadata: Metadata = {
  title: "Largo Answer Preview · Admin · BlackOut",
  description: "Admin render harness for the BieAnswerEnvelope UI components.",
};

export const revalidate = 0;

// Admin-only visual harness for the PR 2 answer components. Not a member surface —
// it renders fixture envelopes so the section cards / evidence panel / levels table /
// scenario cards / confidence + provenance chips can be verified in a real build
// before they're wired into the live terminal (PR 3).
export default async function LargoAnswerPreviewPage() {
  await requireAdmin();

  return (
    <div className="admin-page admin-page-canvas">
      <main id="main" className="admin-page-main">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-widest text-white/35">
          <Link href="/admin" className="transition-colors hover:text-bull">
            ← Admin
          </Link>
        </p>
        <h1 className="mb-1 font-anton text-3xl uppercase tracking-wide text-white">
          Largo Answer Preview
        </h1>
        <p className="mb-6 text-sm text-white/60">
          BieAnswerEnvelope UI (task #64 PR 2) — fixture-driven, admin-only.
        </p>
        <LargoAnswerPreview />
      </main>
    </div>
  );
}
