"use client";

import { Fragment, type ReactNode } from "react";
import { clsx } from "clsx";

const TICKERS = new Set([
  "SPX", "SPY", "QQQ", "IWM", "VIX", "NDX", "ES", "NQ", "SPXW", "NVDA", "AAPL", "TSLA", "META", "MSFT", "AMZN", "GOOG", "GOOGL",
]);

const KEY_TERMS: Record<string, string> = {
  gex: "key",
  gamma: "key",
  vwap: "key",
  "max pain": "key",
  "0dte": "key",
  "iv rank": "key",
  "dark pool": "key",
  nope: "key",
  dealer: "key",
  confluence: "key",
  "gamma flip": "key",
};

const KEY_PHRASES = Object.entries(KEY_TERMS).sort((a, b) => b[0].length - a[0].length);

const BULL_WORDS = new Set([
  "bullish", "long", "calls", "call", "support", "reclaim", "breakout", "bid", "accumulation", "squeeze",
]);

const BEAR_WORDS = new Set([
  "bearish", "short", "puts", "put", "resistance", "breakdown", "reject", "fade", "distribution",
]);

type TokenKind = "text" | "bold" | "italic" | "code" | "num" | "ticker" | "bull" | "bear" | "key" | "pct-up" | "pct-down";

type Token = { kind: TokenKind; value: string };

const NUM_RE =
  /(\$[\d,]+(?:\.\d+)?[kKmMbB]?|[\+\-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?%|[\+\-]?\d+(?:\.\d+)?\s*(?:pts?|points?|bpm))/gi;

function parseMarkdownTokens(segment: string): Token[] {
  const out: Token[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    if (m.index > last) out.push(...tokenizePlain(segment.slice(last, m.index)));
    const raw = m[0];
    if (raw.startsWith("**")) out.push({ kind: "bold", value: raw.slice(2, -2) });
    else if (raw.startsWith("*")) out.push({ kind: "italic", value: raw.slice(1, -1) });
    else out.push({ kind: "code", value: raw.slice(1, -1) });
    last = m.index + raw.length;
  }
  if (last < segment.length) out.push(...tokenizePlain(segment.slice(last)));
  return out;
}

function tokenizePlain(text: string): Token[] {
  if (!text) return [];
  const out: Token[] = [];
  let rest = text;

  while (rest.length) {
    const lower = rest.toLowerCase();
    let matched = false;

    for (const [phrase, kind] of KEY_PHRASES) {
      if (lower.startsWith(phrase)) {
        const next = rest[phrase.length];
        if (!next || /[^a-z0-9]/i.test(next)) {
          out.push({ kind: kind as TokenKind, value: rest.slice(0, phrase.length) });
          rest = rest.slice(phrase.length);
          matched = true;
          break;
        }
      }
    }
    if (matched) continue;

    const word = rest.match(/^[A-Za-z][A-Za-z']*/);
    if (word) {
      const w = word[0];
      const upper = w.toUpperCase();
      const lowerW = w.toLowerCase();
      if (TICKERS.has(upper)) {
        out.push({ kind: "ticker", value: w });
        rest = rest.slice(w.length);
        continue;
      }
      if (BULL_WORDS.has(lowerW)) {
        out.push({ kind: "bull", value: w });
        rest = rest.slice(w.length);
        continue;
      }
      if (BEAR_WORDS.has(lowerW)) {
        out.push({ kind: "bear", value: w });
        rest = rest.slice(w.length);
        continue;
      }
    }

    NUM_RE.lastIndex = 0;
    const num = NUM_RE.exec(rest);
    if (num && num.index === 0) {
      const val = num[0];
      const kind: TokenKind =
        val.includes("%") && val.startsWith("-")
          ? "pct-down"
          : val.includes("%") && (val.startsWith("+") || !val.startsWith("-"))
            ? "pct-up"
            : "num";
      out.push({ kind, value: val });
      rest = rest.slice(val.length);
      continue;
    }

    const tick = rest.match(/^\$[A-Z]{1,5}\b/);
    if (tick) {
      out.push({ kind: "ticker", value: tick[0].slice(1) });
      rest = rest.slice(tick[0].length);
      continue;
    }

    out.push({ kind: "text", value: rest[0] });
    rest = rest.slice(1);
  }

  return mergeAdjacentText(out);
}

function mergeAdjacentText(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const t of tokens) {
    const prev = out[out.length - 1];
    if (t.kind === "text" && prev?.kind === "text") prev.value += t.value;
    else out.push({ ...t });
  }
  return out;
}

function tokenClass(kind: TokenKind): string {
  switch (kind) {
    case "bold":
      return "largo-fmt-bold";
    case "italic":
      return "largo-fmt-italic";
    case "code":
      return "largo-fmt-code";
    case "num":
      return "largo-fmt-num";
    case "ticker":
      return "largo-fmt-ticker";
    case "bull":
      return "largo-fmt-bull";
    case "bear":
      return "largo-fmt-bear";
    case "key":
      return "largo-fmt-key";
    case "pct-up":
      return "largo-fmt-pct-up";
    case "pct-down":
      return "largo-fmt-pct-down";
    default:
      return "";
  }
}

function renderTokens(tokens: Token[]): ReactNode {
  return tokens.map((t, i) => {
    if (t.kind === "text") return <Fragment key={i}>{t.value}</Fragment>;
    return (
      <span key={i} className={tokenClass(t.kind)}>
        {t.value}
      </span>
    );
  });
}

function renderLine(line: string): ReactNode {
  return renderTokens(parseMarkdownTokens(line));
}

type LargoMessageBodyProps = {
  content: string;
  className?: string;
};

export function LargoMessageBody({ content, className }: LargoMessageBodyProps) {
  const lines = content.split("\n");
  const blocks: Array<{ type: "para" | "list"; lines: string[] }> = [];
  let listBuf: string[] = [];

  const flushList = () => {
    if (listBuf.length) {
      blocks.push({ type: "list", lines: listBuf });
      listBuf = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[-•*]\s+/.test(trimmed)) {
      listBuf.push(trimmed.replace(/^[-•*]\s+/, ""));
    } else if (!trimmed) {
      flushList();
      blocks.push({ type: "para", lines: [""] });
    } else {
      flushList();
      const last = blocks[blocks.length - 1];
      if (last?.type === "para" && last.lines.length === 1 && last.lines[0] !== "") {
        last.lines.push(line);
      } else {
        blocks.push({ type: "para", lines: [line] });
      }
    }
  }
  flushList();

  return (
    <div className={clsx("largo-message-body", className)}>
      {blocks.map((block, bi) => {
        if (block.type === "list") {
          return (
            <ul key={bi} className="largo-fmt-list">
              {block.lines.map((item, li) => (
                <li key={li}>{renderLine(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.lines.length === 1 && block.lines[0] === "") {
          return <div key={bi} className="largo-fmt-spacer" />;
        }
        return (
          <p key={bi} className="largo-fmt-para">
            {block.lines.map((ln, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {renderLine(ln)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
