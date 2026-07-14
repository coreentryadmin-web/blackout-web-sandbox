/**
 * Build UW/Massive OCC contract ids from HELIX flow fields.
 * UW expects bare OCC (no `O:` prefix); Massive snapshot uses `O:` — strip when calling UW.
 */
export function buildOccContractId(
  ticker: string,
  expiry: string,
  optionType: "CALL" | "PUT",
  strike: number
): string | null {
  const rawRoot = ticker.trim().toUpperCase();
  if (!rawRoot) return null;
  const root = rawRoot === "SPX" ? "SPXW" : rawRoot;
  if (!/^[A-Z]{1,6}$/.test(root)) return null;

  const ymd = expiry.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const date = `${m[1].slice(2)}${m[2]}${m[3]}`;

  if (!Number.isFinite(strike) || strike <= 0) return null;
  const strikeInt = Math.round(strike * 1000);
  if (strikeInt <= 0 || strikeInt > 99_999_999) return null;
  const strikeStr = String(strikeInt).padStart(8, "0");
  const cp = optionType === "PUT" ? "P" : "C";

  return `${root}${date}${cp}${strikeStr}`;
}

export function contractLabel(
  ticker: string,
  strike: number,
  optionType: "CALL" | "PUT",
  expiry?: string
): string {
  const side = optionType === "CALL" ? "C" : "P";
  const exp = expiry ? ` ${expiry.slice(5).replace("-", "/")}` : "";
  return `${ticker} ${strike}${side}${exp}`;
}
