import { isIosAppShell } from "@/lib/ios-app-shell";

type CapHaptics = {
  impact: (opts: { style: "Light" | "Medium" | "Heavy" }) => Promise<void>;
  selectionStart: () => Promise<void>;
  selectionChanged: () => Promise<void>;
  selectionEnd: () => Promise<void>;
};

function hapticsPlugin(): CapHaptics | undefined {
  if (typeof window === "undefined") return undefined;
  const cap = (window as Window & { Capacitor?: { Plugins?: { Haptics?: CapHaptics } } }).Capacitor;
  return cap?.Plugins?.Haptics;
}

/** Light tap — tab switches, chip selects (no-op on web). */
export function iosHapticSelection(): void {
  if (!isIosAppShell()) return;
  const h = hapticsPlugin();
  if (!h) return;
  void h.selectionStart()
    .then(() => h.selectionChanged())
    .then(() => h.selectionEnd())
    .catch(() => {});
}

/** Medium impact — sheet open, primary actions. */
export function iosHapticImpact(style: "Light" | "Medium" | "Heavy" = "Light"): void {
  if (!isIosAppShell()) return;
  const h = hapticsPlugin();
  if (!h) return;
  void h.impact({ style }).catch(() => {});
}
