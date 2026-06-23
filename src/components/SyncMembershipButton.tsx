"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@clerk/nextjs";

export function SyncMembershipButton() {
  const router = useRouter();
  const { session } = useSession();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/membership/sync", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error ?? "Sync failed. Try again in a moment.");
        return;
      }

      setMessage(`Access updated: ${String(data.tier).toUpperCase()}`);
      await session?.reload();
      router.refresh();
    } catch {
      setMessage("Sync failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button type="button" onClick={handleSync} disabled={loading} className="btn-outline-bull">
        {loading ? "Syncing..." : "I paid — refresh my access"}
      </button>
      {message && (
        <p role="status" aria-live="polite" className="font-mono text-xs text-bull text-center">
          {message.startsWith("Access updated") ? `✓ ${message}` : message}
        </p>
      )}
    </div>
  );
}
