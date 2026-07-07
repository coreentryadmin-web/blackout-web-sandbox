import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PlaybookBoard } from "./PlaybookBoard";
import type { NightHawkEdition } from "@/features/nighthawk/lib/types";

test("PlaybookBoard renders the centered build phrase in five empty play slots", () => {
  const edition: NightHawkEdition = {
    available: false,
    edition_for: "2026-07-01",
    published_at: null,
    recap_headline: null,
    recap_summary: null,
    market_recap: null,
    plays: [],
  };

  const html = renderToStaticMarkup(<PlaybookBoard edition={edition} />);

  assert.equal((html.match(/The Hawk is circling/g) ?? []).length, 5);
  assert.match(html, /Tomorrow&#x27;s playbook is being forged from live tape/);
});

test("PlaybookBoard explains active plays are carried until session close", () => {
  const edition: NightHawkEdition = {
    available: true,
    edition_for: "2026-06-30",
    published_at: "2026-06-29T21:30:00.000Z",
    recap_headline: "Evening Playbook",
    recap_summary: "Market recap",
    market_recap: null,
    carry_until_close: true,
    plays: [
      {
        rank: 1,
        ticker: "QCOM",
        direction: "LONG",
        conviction: "B",
        play_type: "stock",
        thesis: "Grounded setup",
        key_signal: "Grounded setup",
        entry_range: "$200",
        target: "$215",
        stop: "$190",
        options_play: "QCOM CALL $200 2026-08-21, entry prem ~$15.80",
        entry_premium: 15.8,
        entry_cost_per_contract: 1580,
        score: 72,
      },
    ],
  };

  const html = renderToStaticMarkup(<PlaybookBoard edition={edition} />);

  assert.match(html, /Today&#x27;s generated plays stay live until the session close/);
});
