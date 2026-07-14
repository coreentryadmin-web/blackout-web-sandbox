/**
 * Real UW `spot-exposures/strike` rows for $FIG, captured live 2026-07-13 EOD (spot ~23.77) — the
 * exact snapshot the Skylit reverse-engineering used (docs/audit/FINDINGS.md — FLOW-GEX LENS).
 * Only the fields the flow model reads are kept (strike, price, call/put gamma bid/ask). Used by
 * `vector-flow-gex.test.ts` to prove the flow lens reproduces Skylit's published sign pattern +
 * dominant strike. Do NOT edit the numbers — they are ground truth for the fit.
 */
export const FIG_SPOT_EXPOSURES: Array<Record<string, string>> = [
  { strike: "2.5", price: "23.725", call_gamma_bid: "0.37", call_gamma_ask: "-1.29", put_gamma_bid: "0", put_gamma_ask: "0" },
  { strike: "5", price: "23.725", call_gamma_bid: "0", call_gamma_ask: "0", put_gamma_bid: "0", put_gamma_ask: "0" },
  { strike: "7.5", price: "23.725", call_gamma_bid: "0", call_gamma_ask: "-2.14", put_gamma_bid: "37.01", put_gamma_ask: "-1.76" },
  { strike: "10", price: "23.725", call_gamma_bid: "16.03", call_gamma_ask: "-42.65", put_gamma_bid: "32.95", put_gamma_ask: "-9.56" },
  { strike: "11", price: "23.725", call_gamma_bid: "0.02", call_gamma_ask: "-0.02", put_gamma_bid: "0", put_gamma_ask: "0" },
  { strike: "12", price: "23.725", call_gamma_bid: "0.12", call_gamma_ask: "-0.22", put_gamma_bid: "8.76", put_gamma_ask: "0" },
  { strike: "12.5", price: "23.725", call_gamma_bid: "54.53", call_gamma_ask: "-78.5", put_gamma_bid: "3031.25", put_gamma_ask: "-9.13" },
  { strike: "13", price: "23.725", call_gamma_bid: "0.47", call_gamma_ask: "-0.15", put_gamma_bid: "8.42", put_gamma_ask: "0" },
  { strike: "13.5", price: "23.725", call_gamma_bid: "0", call_gamma_ask: "0", put_gamma_bid: "0", put_gamma_ask: "0" },
  { strike: "14", price: "23.725", call_gamma_bid: "1.73", call_gamma_ask: "-1.73", put_gamma_bid: "7.4", put_gamma_ask: "-7.4" },
  { strike: "14.5", price: "23.725", call_gamma_bid: "1.02", call_gamma_ask: "-4.07", put_gamma_bid: "77.36", put_gamma_ask: "-61.44" },
  { strike: "15", price: "23.77", call_gamma_bid: "199.29", call_gamma_ask: "-267.5", put_gamma_bid: "2457.65", put_gamma_ask: "-3713.21" },
  { strike: "15.5", price: "23.725", call_gamma_bid: "11.74", call_gamma_ask: "-5.36", put_gamma_bid: "18.53", put_gamma_ask: "0" },
  { strike: "16", price: "23.725", call_gamma_bid: "32.39", call_gamma_ask: "-12.15", put_gamma_bid: "160.19", put_gamma_ask: "-339.02" },
  { strike: "16.5", price: "23.725", call_gamma_bid: "26.68", call_gamma_ask: "-21.35", put_gamma_bid: "956.97", put_gamma_ask: "-339" },
  { strike: "17", price: "23.725", call_gamma_bid: "23.67", call_gamma_ask: "-33.41", put_gamma_bid: "3618.75", put_gamma_ask: "-228.69" },
  { strike: "17.5", price: "23.745", call_gamma_bid: "470.5", call_gamma_ask: "-7038.03", put_gamma_bid: "1616.33", put_gamma_ask: "-1901.73" },
  { strike: "18", price: "23.725", call_gamma_bid: "35.18", call_gamma_ask: "-69.93", put_gamma_bid: "809.86", put_gamma_ask: "-2205.17" },
  { strike: "18.5", price: "23.77", call_gamma_bid: "31.73", call_gamma_ask: "-112.49", put_gamma_bid: "320.76", put_gamma_ask: "-540.98" },
  { strike: "19", price: "23.725", call_gamma_bid: "2581.85", call_gamma_ask: "-1745.81", put_gamma_bid: "1489.47", put_gamma_ask: "-439.5" },
  { strike: "19.5", price: "23.725", call_gamma_bid: "131.13", call_gamma_ask: "-216.62", put_gamma_bid: "621.76", put_gamma_ask: "-860.36" },
  { strike: "20", price: "23.77", call_gamma_bid: "22642.07", call_gamma_ask: "-15505.96", put_gamma_bid: "24842.62", put_gamma_ask: "-15069.68" },
  { strike: "20.5", price: "23.725", call_gamma_bid: "500.44", call_gamma_ask: "-748.59", put_gamma_bid: "4164.53", put_gamma_ask: "-4345.38" },
  { strike: "21", price: "23.725", call_gamma_bid: "2474.24", call_gamma_ask: "-6546.99", put_gamma_bid: "14147.35", put_gamma_ask: "-25358.48" },
  { strike: "21.5", price: "23.725", call_gamma_bid: "6879.63", call_gamma_ask: "-13848.06", put_gamma_bid: "17106.87", put_gamma_ask: "-2957.39" },
  { strike: "22", price: "23.77", call_gamma_bid: "25467.98", call_gamma_ask: "-37567.18", put_gamma_bid: "28820.05", put_gamma_ask: "-17495.92" },
  { strike: "22.5", price: "23.77", call_gamma_bid: "29339.02", call_gamma_ask: "-104613.65", put_gamma_bid: "19597.24", put_gamma_ask: "-22076.66" },
  { strike: "23", price: "23.77", call_gamma_bid: "167127.59", call_gamma_ask: "-170832.99", put_gamma_bid: "61378.05", put_gamma_ask: "-67024.77" },
  { strike: "23.5", price: "23.77", call_gamma_bid: "85583.98", call_gamma_ask: "-106703.33", put_gamma_bid: "62921.66", put_gamma_ask: "-67788.06" },
  { strike: "24", price: "23.77", call_gamma_bid: "130686.64", call_gamma_ask: "-223969.02", put_gamma_bid: "79287.82", put_gamma_ask: "-11907.14" },
  { strike: "24.5", price: "23.77", call_gamma_bid: "75874.7", call_gamma_ask: "-119662.45", put_gamma_bid: "444.4", put_gamma_ask: "-386.62" },
  { strike: "25", price: "23.77", call_gamma_bid: "520065.21", call_gamma_ask: "-470775.51", put_gamma_bid: "4436.09", put_gamma_ask: "-9884.76" },
  { strike: "25.5", price: "23.725", call_gamma_bid: "41.37", call_gamma_ask: "-1584.73", put_gamma_bid: "0", put_gamma_ask: "-44.75" },
  { strike: "26", price: "23.77", call_gamma_bid: "230828.71", call_gamma_ask: "-460379.26", put_gamma_bid: "413.03", put_gamma_ask: "-1547.65" },
  { strike: "26.5", price: "23.725", call_gamma_bid: "1442.57", call_gamma_ask: "-863.78", put_gamma_bid: "0", put_gamma_ask: "-41.76" },
  { strike: "27", price: "23.77", call_gamma_bid: "148059.6", call_gamma_ask: "-152328.32", put_gamma_bid: "208.05", put_gamma_ask: "-87.91" },
  { strike: "27.5", price: "23.725", call_gamma_bid: "444.17", call_gamma_ask: "-1019.85", put_gamma_bid: "0", put_gamma_ask: "0" },
  { strike: "28", price: "23.77", call_gamma_bid: "396509.27", call_gamma_ask: "-2495885.62", put_gamma_bid: "37.09", put_gamma_ask: "-74.18" },
  { strike: "28.5", price: "23.725", call_gamma_bid: "237.83", call_gamma_ask: "-475.66", put_gamma_bid: "0", put_gamma_ask: "-33.82" },
  { strike: "29", price: "23.725", call_gamma_bid: "1856.29", call_gamma_ask: "-123.69", put_gamma_bid: "31.26", put_gamma_ask: "0" },
  { strike: "29.5", price: "23.725", call_gamma_bid: "56.41", call_gamma_ask: "-84.61", put_gamma_bid: "28.8", put_gamma_ask: "0" },
  { strike: "30", price: "23.77", call_gamma_bid: "82762.05", call_gamma_ask: "-65614.52", put_gamma_bid: "1398.74", put_gamma_ask: "-827.8" },
  { strike: "31", price: "23.725", call_gamma_bid: "0", call_gamma_ask: "-23.52", put_gamma_bid: "0", put_gamma_ask: "0" },
  { strike: "32", price: "23.725", call_gamma_bid: "0", call_gamma_ask: "0", put_gamma_bid: "0", put_gamma_ask: "0" },
  { strike: "33", price: "23.725", call_gamma_bid: "0", call_gamma_ask: "0", put_gamma_bid: "0", put_gamma_ask: "0" },
  { strike: "35", price: "23.725", call_gamma_bid: "34043.07", call_gamma_ask: "-45480.55", put_gamma_bid: "657.03", put_gamma_ask: "-76.6" },
  { strike: "40", price: "23.745", call_gamma_bid: "6017.28", call_gamma_ask: "-22342.22", put_gamma_bid: "1026.25", put_gamma_ask: "-13.49" },
  { strike: "45", price: "23.77", call_gamma_bid: "945.22", call_gamma_ask: "-4434.07", put_gamma_bid: "140.11", put_gamma_ask: "-150.88" },
  { strike: "50", price: "23.725", call_gamma_bid: "502", call_gamma_ask: "-2826.47", put_gamma_bid: "0", put_gamma_ask: "0" },
  { strike: "55", price: "23.725", call_gamma_bid: "55.05", call_gamma_ask: "-1399.47", put_gamma_bid: "0", put_gamma_ask: "0" },
];

/**
 * Skylit's 6 published $FIG per-strike $GEX points (member screenshot, spot 23.48/+12%), $K. The
 * SIGN pattern (26/27/28 negative, 22.5/25/30 positive) + the dominant −GEX peak at 28 are the
 * discriminators the flow lens must reproduce; absolute magnitudes differ by a single scale factor
 * (snapshot-time mismatch — see FINDINGS).
 */
export const SKYLIT_FIG_POINTS: Record<string, number> = {
  "22.5": 1141.8,
  "25": 1471.0,
  "26": -389.1,
  "27": -307.1,
  "28": -8110.9,
  "30": 232.6,
};
