import Link from "next/link";
import { Nav } from "@/components/Nav";
import { SyncMembershipButton } from "@/components/SyncMembershipButton";
import {
  WHOP_CHECKOUT,
  WHOP_PREMIUM_CHECKOUT_OPTIONS,
  WHOP_CHECKOUT_UNAVAILABLE_MESSAGE,
} from "@/lib/whop-checkout";

export default function UpgradePage() {
  return (
    <div className="page-shell">
      <Nav />
      <main className="page-main max-w-xl mx-auto text-center">
        <p className="font-mono text-[10px] tracking-[0.4em] text-purple-light uppercase mb-3">
          Membership required
        </p>
        <h1 className="page-title mb-4">Premium Access</h1>
        <p className="text-sky-300 text-sm leading-relaxed mb-8">
          Choose monthly, yearly, or lifetime on Whop. Use the same email as your BlackOut
          account, then refresh your access below.
        </p>

        <div className="flex flex-col gap-3 mb-8">
          {WHOP_PREMIUM_CHECKOUT_OPTIONS.length > 0 ? (
            WHOP_PREMIUM_CHECKOUT_OPTIONS.map((option) => (
              <a
                key={option.label}
                href={option.href}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
              >
                {option.label} on Whop →
              </a>
            ))
          ) : WHOP_CHECKOUT.store ? (
            <a
              href={WHOP_CHECKOUT.store}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
            >
              View plans on Whop →
            </a>
          ) : (
            <p className="text-bear text-sm">{WHOP_CHECKOUT_UNAVAILABLE_MESSAGE}</p>
          )}
        </div>

        <SyncMembershipButton />

        <p className="text-cyan-400 text-xs mt-8 font-mono">
          <Link href="/" className="text-purple-light hover:text-purple">
            Back to home
          </Link>
        </p>
      </main>
    </div>
  );
}
