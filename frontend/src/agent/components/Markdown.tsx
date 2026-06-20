import type { ReactNode } from "react";

/**
 * Dependency-free markdown renderer scoped to what the agent emits:
 * headings, **bold**, `code`, [links](url), bullet/numbered lists and
 * GitHub-style pipe tables. Styled with the terminal-* tokens so agent
 * answers read like the rest of the home-screen UI instead of raw text.
 */

let keySeq = 0;
const k = () => `md${keySeq++}`;

// --- inline: **bold**, `code`, [text](url) -------------------------------
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Single regex pass over the three inline constructs, in order of appearance.
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      nodes.push(
        <strong key={k()} className="font-semibold text-terminal-text">
          {m[1]}
        </strong>,
      );
    } else if (m[2] !== undefined) {
      nodes.push(
        <code
          key={k()}
          className="rounded bg-terminal-bg/60 px-1 py-0.5 font-mono text-[11px] text-terminal-accent"
        >
          {m[2]}
        </code>,
      );
    } else if (m[3] !== undefined) {
      nodes.push(
        <a
          key={k()}
          href={m[4]}
          target="_blank"
          rel="noreferrer"
          className="text-terminal-accent underline decoration-terminal-accent/40 underline-offset-2 hover:decoration-terminal-accent"
        >
          {m[3]}
        </a>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isTableSep(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}

function Table({ rows }: { rows: string[] }) {
  const header = splitRow(rows[0]);
  const body = rows.slice(2).map(splitRow);
  return (
    <div className="overflow-x-auto rounded-sm border border-terminal-border">
      <table className="w-full border-collapse font-mono text-[11px]">
        <thead>
          <tr className="bg-terminal-bg/40">
            {header.map((c, i) => (
              <th
                key={i}
                className="whitespace-nowrap border-b border-terminal-border px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-terminal-accent"
              >
                {renderInline(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className="even:bg-terminal-bg/20">
              {header.map((_, ci) => (
                <td
                  key={ci}
                  className="whitespace-nowrap border-b border-terminal-border/50 px-2 py-1 text-terminal-text"
                >
                  {renderInline(r[ci] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Markdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // table: header row + separator row + body
    if (line.trim().startsWith("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const tbl: string[] = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tbl.push(lines[i]);
        i++;
      }
      blocks.push(<Table key={k()} rows={tbl} />);
      continue;
    }

    // heading
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      blocks.push(
        <div
          key={k()}
          className={`font-semibold uppercase tracking-wide text-terminal-accent ${
            level <= 2 ? "text-xs" : "text-[11px]"
          }`}
        >
          {renderInline(h[2])}
        </div>,
      );
      i++;
      continue;
    }

    // bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={k()} className="flex list-none flex-col gap-0.5 pl-1">
          {items.map((it) => (
            <li key={k()} className="flex gap-1.5 text-terminal-muted">
              <span className="select-none text-terminal-accent">›</span>
              <span className="flex-1">{renderInline(it)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={k()} className="flex list-none flex-col gap-0.5 pl-1">
          {items.map((it, idx) => (
            <li key={k()} className="flex gap-1.5 text-terminal-muted">
              <span className="select-none font-mono text-terminal-accent">{idx + 1}.</span>
              <span className="flex-1">{renderInline(it)}</span>
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // paragraph (merge consecutive non-empty, non-structural lines)
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("|") &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={k()} className="leading-5 text-terminal-text">
        {renderInline(para.join(" "))}
      </p>,
    );
  }

  return <div className="flex flex-col gap-2 text-[13px]">{blocks}</div>;
}
