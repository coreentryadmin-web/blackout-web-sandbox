"use client";

import { Fragment, type ReactNode } from "react";
import { clsx } from "clsx";

type TokenKind = "text" | "bold" | "italic" | "code" | "num";

type Token = { kind: TokenKind; value: string };

type ContentBlock =
  | { type: "spacer" }
  | { type: "verdict"; text: string }
  | { type: "bottomline"; paragraphs: string[]; bullets: string[] }
  | { type: "section"; title: string; inline?: string }
  | { type: "list"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "para"; lines: string[] };

const NUM_RE =
  /(\$[\d,]+(?:\.\d+)?[kKmMbB]?|[\+\-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?%|[\+\-]?\d+\.\d+|[\+\-]?\d{2,}|[\+\-]?\d+\s*(?:pts?|points?|bpm))/gi;

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.split("|").length >= 3;
}

function isTableSeparator(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line.trim());
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}

function isHeaderRow(cells: string[]): boolean {
  const joined = cells.join(" ").toLowerCase();
  return (
    cells.length >= 2 &&
    (joined.includes("level") ||
      joined.includes("value") ||
      joined.includes("note") ||
      joined.includes("metric") ||
      cells.every((c) => /^[a-z\s/]+$/i.test(c) && c.length < 24))
  );
}

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
  let last = 0;
  let m: RegExpExecArray | null;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: "text", value: text.slice(last, m.index) });
    out.push({ kind: "num", value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out.length ? out : [{ kind: "text", value: text }];
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

function isVerdictLine(line: string): boolean {
  const t = line.trim();
  return (
    /^\*\*bias\b/i.test(t) ||
    /^\*\*verdict\b/i.test(t) ||
    /^\*\*play\b/i.test(t) ||
    /^\*\*signal\b/i.test(t) ||
    (/grade\s+[a-d][+-]?/i.test(t) && /short|long|puts?|calls?|hold|neutral/i.test(t))
  );
}

function isBottomLineTitle(title: string): boolean {
  return /bottom\s*line/i.test(title.trim());
}

function isSectionLine(line: string): { title: string; inline?: string } | null {
  const t = line.trim();
  const alone = t.match(/^\*\*(.+?):\*\*\s*$/);
  if (alone) return { title: alone[1] };
  const inline = t.match(/^\*\*(.+?):\*\*\s+(.+)$/);
  if (inline) return { title: inline[1], inline: inline[2] };
  const hash = t.match(/^#{1,3}\s+(.+)$/);
  if (hash) return { title: hash[1] };
  return null;
}

function parseContentBlocks(content: string): ContentBlock[] {
  const lines = content.split("\n");
  const blocks: ContentBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed || /^-{3,}$/.test(trimmed)) {
      if (blocks[blocks.length - 1]?.type !== "spacer") blocks.push({ type: "spacer" });
      i++;
      continue;
    }

    if (isTableRow(trimmed)) {
      const parsed: string[][] = [];
      while (i < lines.length) {
        const row = lines[i].trim();
        if (!isTableRow(row)) break;
        if (!isTableSeparator(row)) parsed.push(parseTableRow(row));
        i++;
      }
      if (parsed.length) {
        const headers = isHeaderRow(parsed[0]) ? parsed[0] : ["Level", "Value", "Context"].slice(0, parsed[0].length);
        const rows = isHeaderRow(parsed[0]) ? parsed.slice(1) : parsed;
        blocks.push({ type: "table", headers, rows });
      }
      continue;
    }

    if (isVerdictLine(trimmed)) {
      blocks.push({ type: "verdict", text: trimmed });
      i++;
      continue;
    }

    const section = isSectionLine(trimmed);
    if (section && isBottomLineTitle(section.title)) {
      const paragraphs: string[] = section.inline ? [section.inline] : [];
      const bullets: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i].trim();
        if (!next || /^-{3,}$/.test(next)) {
          i++;
          continue;
        }
        if (isTableRow(next) || isSectionLine(next) || isVerdictLine(next)) break;
        if (/^[-•*]\s+/.test(next)) {
          while (i < lines.length && /^[-•*]\s+/.test(lines[i].trim())) {
            bullets.push(lines[i].trim().replace(/^[-•*]\s+/, ""));
            i++;
          }
          continue;
        }
        const paraLines: string[] = [lines[i]];
        i++;
        while (i < lines.length) {
          const peek = lines[i].trim();
          if (
            !peek ||
            /^-{3,}$/.test(peek) ||
            isTableRow(peek) ||
            /^[-•*]\s+/.test(peek) ||
            isSectionLine(peek) ||
            isVerdictLine(peek)
          ) {
            break;
          }
          paraLines.push(lines[i]);
          i++;
        }
        paragraphs.push(paraLines.join("\n"));
      }
      blocks.push({ type: "bottomline", paragraphs, bullets });
      continue;
    }

    if (section) {
      blocks.push({ type: "section", title: section.title, inline: section.inline });
      i++;
      continue;
    }

    if (/^[-•*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-•*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-•*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    const paraLines: string[] = [lines[i]];
    i++;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (
        !next ||
        /^-{3,}$/.test(next) ||
        isTableRow(next) ||
        /^[-•*]\s+/.test(next) ||
        isSectionLine(next) ||
        isVerdictLine(next)
      ) {
        break;
      }
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "para", lines: paraLines });
  }

  return blocks;
}

function renderTable(headers: string[], rows: string[][]) {
  const cols = Math.max(headers.length, ...rows.map((r) => r.length), 2);
  const h = headers.length >= cols ? headers : ["Level", "Value", "Note"].slice(0, cols);

  return (
    <div className="largo-level-grid" role="table">
      <div className="largo-level-grid-head" role="row">
        {h.map((cell, ci) => (
          <span key={ci} className="largo-level-grid-th" role="columnheader">
            {cell}
          </span>
        ))}
      </div>
      {rows.map((row, ri) => (
        <div key={ri} className="largo-level-grid-row" role="row">
          {Array.from({ length: cols }).map((_, ci) => (
            <span
              key={ci}
              className={clsx(
                "largo-level-grid-cell",
                ci === 0 && "largo-level-grid-label",
                ci === 1 && "largo-level-grid-value",
                ci >= 2 && "largo-level-grid-note"
              )}
              role="cell"
            >
              {row[ci] ? renderLine(row[ci]) : "—"}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

type LargoMessageBodyProps = {
  content: string;
  className?: string;
};

export function LargoMessageBody({ content, className }: LargoMessageBodyProps) {
  const blocks = parseContentBlocks(content);

  return (
    <div className={clsx("largo-message-body", className)}>
      {blocks.map((block, bi) => {
        if (block.type === "spacer") return <div key={bi} className="largo-fmt-spacer" />;

        if (block.type === "verdict") {
          return (
            <div key={bi} className="largo-fmt-verdict">
              {renderLine(block.text)}
            </div>
          );
        }

        if (block.type === "bottomline") {
          return (
            <div key={bi} className="largo-fmt-bottomline">
              <p className="largo-fmt-bottomline-title">Bottom line</p>
              {block.paragraphs.map((para, pi) => (
                <p key={pi} className="largo-fmt-bottomline-body">
                  {renderLine(para)}
                </p>
              ))}
              {block.bullets.length > 0 ? (
                <ul className="largo-fmt-bottomline-list">
                  {block.bullets.map((item, li) => (
                    <li key={li}>{renderLine(item)}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        }

        if (block.type === "section") {
          return (
            <div key={bi} className="largo-fmt-section">
              <p className="largo-fmt-section-title">{block.title}</p>
              {block.inline ? <p className="largo-fmt-para">{renderLine(block.inline)}</p> : null}
            </div>
          );
        }

        if (block.type === "table") {
          return <Fragment key={bi}>{renderTable(block.headers, block.rows)}</Fragment>;
        }

        if (block.type === "list") {
          return (
            <ul key={bi} className="largo-fmt-list">
              {block.items.map((item, li) => (
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
