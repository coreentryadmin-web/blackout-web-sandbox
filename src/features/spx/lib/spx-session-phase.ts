/** ET session phase label for SPX desk reads (commentary + BIE composers). */
export function spxSessionPhase(asOf?: string | null): string {
  const asOfMs = asOf ? new Date(asOf).getTime() : Date.now();
  const et = new Date(new Date(asOfMs).toLocaleString("en-US", { timeZone: "America/New_York" }));
  const etMins = et.getHours() * 60 + et.getMinutes();
  if (etMins < 570) return "pre-market";
  if (etMins < 600) return "opening-range";
  if (etMins < 660) return "mid-morning";
  if (etMins < 780) return "midday-grind";
  if (etMins < 870) return "afternoon";
  if (etMins < 930) return "power-hour";
  return "final-30";
}
