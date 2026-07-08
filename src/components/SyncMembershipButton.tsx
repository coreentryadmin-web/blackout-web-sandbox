"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppAuth } from "@/lib/auth-client";

export function SyncMembershipButton() {
  const router = useRouter();
  const { isSignedIn } = useAppAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/membership/sync", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error ?? "Sync failed. Stand by and re-arm in a moment.");
        return;
      }

      // The endpoint returns 200/ok:true whenever the sync itself completed without error —
      // that includes the legitimate case where no active membership was found and the
      // resolved tier is "free". Branching on res.ok alone (the old bug) showed a green
      // "Access granted" success state to non-paying users. Branch on the actual tier instead.
      if (data.tier === "premium") {
        setMessage(`Access granted — ${String(data.tier).toUpperCase()}. Floor is open.`);
        router.refresh();
      } else {
        setMessage("No active Premium membership found. If you already paid, allow a minute for Whop to sync, then try again — or contact support.");
      }
    } catch {
      setMessage("Sync failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button type="button" onClick={handleSync} disabled={loading} className="btn-outline-bull">
        {loading ? "Syncing…" : "I paid — refresh my access"}
      </button>
      {message && (
        <p
          role="status"
          aria-live="polite"
          className={`font-mono text-xs text-center ${
            message.startsWith("Access granted") ? "text-bull" : "text-bear"
          }`}
        >
          {message.startsWith("Access granted") ? `✓ ${message}` : message}
        </p>
      )}
    </div>
  );
}
