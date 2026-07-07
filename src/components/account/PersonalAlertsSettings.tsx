"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { clsx } from "clsx";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; configured: boolean; host: string | null };

const FIELD_CLASS =
  "h-9 w-full rounded-lg border border-white/12 bg-white/[0.04] px-3 font-mono text-[13px] text-white " +
  "placeholder:text-sky-300/50 " +
  "focus-visible:outline-none focus-visible:border-sky-400/60 focus-visible:ring-1 focus-visible:ring-sky-400/40";

const LABEL_CLASS = "font-mono text-[10px] uppercase tracking-[0.16em] text-sky-300";

/**
 * Self-serve Discord webhook for personal play alerts (/api/account/personal-alerts).
 * The webhook URL is never returned in full — only a redacted host for confirmation.
 */
export function PersonalAlertsSettings() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<null | "save" | "clear">(null);
  const [message, setMessage] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/personal-alerts", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setState({
          kind: "ready",
          configured: false,
          host: null,
        });
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setState({ kind: "error", message: data?.error ?? "Failed to load alert settings." });
        return;
      }
      const data = (await res.json()) as { configured: boolean; host: string | null };
      setState({ kind: "ready", configured: data.configured, host: data.host ?? null });
    } catch {
      setState({ kind: "error", message: "Network error — could not load alert settings." });
    } finally {
      loadedOnce.current = true;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setMessage("Paste a Discord webhook URL to save.");
      return;
    }
    setBusy("save");
    try {
      const res = await fetch("/api/account/personal-alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; host?: string } | null;
      if (!res.ok) {
        setMessage(data?.error ?? "Could not save webhook.");
        return;
      }
      setUrl("");
      setMessage("Webhook saved. Delivery still requires the operator to enable personal alerts.");
      await load();
    } catch {
      setMessage("Network error — could not save webhook.");
    } finally {
      setBusy(null);
    }
  }

  async function handleClear() {
    setMessage(null);
    setBusy("clear");
    try {
      const res = await fetch("/api/account/personal-alerts", { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setMessage(data?.error ?? "Could not clear webhook.");
        return;
      }
      setUrl("");
      setMessage("Personal webhook cleared.");
      await load();
    } catch {
      setMessage("Network error — could not clear webhook.");
    } finally {
      setBusy(null);
    }
  }

  if (state.kind === "loading" && !loadedOnce.current) {
    return (
      <p className="font-mono text-[11px] text-sky-300/80" aria-busy>
        Loading alert settings…
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex flex-col gap-2">
        <p className="font-mono text-[11px] text-bear">{state.message}</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  const configured = state.kind === "ready" && state.configured;

  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[11px] leading-relaxed text-sky-300/90">
        Route your personal play alerts to your own Discord channel. Your webhook stays
        server-side — we only show a redacted host here.
      </p>

      {configured && state.kind === "ready" && (
        <p className="font-mono text-[11px] text-emerald-300">
          Configured{state.host ? `: ${state.host}` : ""}
        </p>
      )}

      <form onSubmit={handleSave} className="flex flex-col gap-2" noValidate>
        <label htmlFor="nw-personal-webhook" className={LABEL_CLASS}>
          Discord webhook URL
        </label>
        <input
          id="nw-personal-webhook"
          type="url"
          inputMode="url"
          autoComplete="off"
          className={FIELD_CLASS}
          placeholder="https://discord.com/api/webhooks/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-describedby={message ? "nw-personal-webhook-msg" : undefined}
        />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="submit" variant="primary" size="sm" loading={busy === "save"} disabled={busy != null}>
            Save webhook
          </Button>
          {configured && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={busy === "clear"}
              disabled={busy != null}
              onClick={() => void handleClear()}
            >
              Clear
            </Button>
          )}
        </div>
      </form>

      {message && (
        <p
          id="nw-personal-webhook-msg"
          role="status"
          className={clsx(
            "font-mono text-[11px] leading-relaxed",
            message.includes("error") || message.includes("Could not") ? "text-bear" : "text-sky-300"
          )}
        >
          {message}
        </p>
      )}
    </div>
  );
}
