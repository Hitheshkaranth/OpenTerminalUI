import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { SparklineCell } from "../home/SparklineCell";

export type OpenScriptCompileError = { message: string; line?: number | null; col?: number | null };
export type OpenScriptOutput = {
  kind: string;
  title?: string | null;
  color?: string | null;
  linewidth?: number | null;
  message?: string | null;
  series: Array<number | string | boolean | null>;
  metadata?: Record<string, unknown>;
};
export type OpenScriptCompileResult = { success: boolean; outputs: Array<Record<string, unknown>>; errors: OpenScriptCompileError[] };
export type OpenScriptRunResult = { script_id: string; script_name: string; outputs: OpenScriptOutput[]; row_count: number };

export const DEFAULT_OPENSCRIPT_TEMPLATE = `// My Custom Indicator
// Modify this script and press Ctrl+S to compile

fast = ema(close, 9)
slow = ema(close, 21)
plot(fast, "Fast EMA", "blue", 2)
plot(slow, "Slow EMA", "red", 2)
`;

type ScriptEditorProps = {
  chartSymbol: string;
  chartMarket: string;
  source: string;
  title: string;
  description: string;
  isPublic: boolean;
  selectedScriptId: string | null;
  dirty: boolean;
  saving: boolean;
  running: boolean;
  compileResult: OpenScriptCompileResult | null;
  runResult: OpenScriptRunResult | null;
  onSourceChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onPublicChange: (value: boolean) => void;
  onSave: () => void;
  onRun: () => void;
  onClose: () => void;
  onIndicatorOutput: (outputs: OpenScriptOutput[]) => void;
};

const BUILTIN_SUGGESTIONS = [
  ["sma", "sma(series, length)", "Simple moving average", 'sma(close, 20)'],
  ["ema", "ema(series, length)", "Exponential moving average", 'ema(close, 20)'],
  ["rsi", "rsi(series, length)", "Relative strength index", 'rsi(close, 14)'],
  ["crossover", "crossover(left, right)", "Crosses above right", "crossover(fast, slow)"],
  ["crossunder", "crossunder(left, right)", "Crosses below right", "crossunder(fast, slow)"],
  ["highest", "highest(series, length)", "Rolling highest value", "highest(high, 20)"],
  ["lowest", "lowest(series, length)", "Rolling lowest value", "lowest(low, 20)"],
] as const;

const SNIPPETS = [
  { label: "Plot", value: 'plot(close, "Close", "cyan", 2)' },
  { label: "HLine", value: 'hline(close, "Spot", "amber")' },
  { label: "Alert", value: 'alertcondition(crossover(fast, slow), "Fast Cross", "Fast EMA crossed slow EMA")' },
];

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightLine(line: string): string {
  let out = escapeHtml(line);
  out = out.replace(/(\/\/.*$)/, '<span style="color:#6b7280">$1</span>');
  out = out.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span style="color:#f59e0b">$1</span>');
  out = out.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span style="color:#fb923c">$1</span>');
  out = out.replace(/\b(and|or|not|true|false)\b/gi, '<span style="color:#60a5fa;font-weight:600">$1</span>');
  out = out.replace(/\b(plot|hline|bgcolor|alertcondition)\b/gi, '<span style="color:#d946ef;font-weight:600">$1</span>');
  out = out.replace(/\b(sma|ema|rsi|crossover|crossunder|highest|lowest)\b/gi, '<span style="color:#22d3ee;font-weight:600">$1</span>');
  out = out.replace(/\b(open|high|low|close|volume)\b/gi, '<span style="color:#4ade80">$1</span>');
  return out || "&nbsp;";
}

function highlightSource(source: string): string {
  return source.split("\n").map(highlightLine).join("\n");
}

function lineOffsets(source: string): number[] {
  const lines = source.split("\n");
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }
  return offsets;
}

function currentToken(source: string, cursorIndex: number): string {
  const left = source.slice(0, cursorIndex).match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] ?? "";
  const right = source.slice(cursorIndex).match(/^[A-Za-z0-9_]*/)?.[0] ?? "";
  return `${left}${right}`;
}

function suggestionFor(token: string) {
  const lowered = token.trim().toLowerCase();
  if (!lowered) return null;
  return BUILTIN_SUGGESTIONS.find((item) => item[0] === lowered) ?? BUILTIN_SUGGESTIONS.find((item) => item[0].startsWith(lowered)) ?? null;
}

function numericSeries(series: OpenScriptOutput["series"]): number[] {
  return series.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : null)).filter((value): value is number => value !== null);
}

function compileSummary(result: OpenScriptCompileResult | null): string {
  if (!result) return "No compile result yet.";
  if (!result.success) return result.errors.length ? `${result.errors.length} error(s) found.` : "Compilation failed.";
  return `${result.outputs.length} output(s) ready.`;
}

export function ScriptEditor({
  chartSymbol,
  chartMarket,
  source,
  title,
  description,
  isPublic,
  selectedScriptId,
  dirty,
  saving,
  running,
  compileResult,
  runResult,
  onSourceChange,
  onTitleChange,
  onDescriptionChange,
  onPublicChange,
  onSave,
  onRun,
  onClose,
  onIndicatorOutput,
}: ScriptEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<HTMLPreElement | null>(null);
  const [tab, setTab] = useState<"errors" | "output">("errors");
  const [cursor, setCursor] = useState(0);
  const [showCompletions, setShowCompletions] = useState(false);
  const [completionIndex, setCompletionIndex] = useState(0);

  useEffect(() => {
    if (runResult) onIndicatorOutput(runResult.outputs);
  }, [onIndicatorOutput, runResult]);

  useEffect(() => {
    const ta = textareaRef.current;
    const pre = previewRef.current;
    if (!ta || !pre) return;
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }, [source]);

  const token = useMemo(() => currentToken(source, cursor), [cursor, source]);
  const suggestion = useMemo(() => suggestionFor(token), [token]);
  const completionItems = useMemo(() => {
    const q = token.trim().toLowerCase();
    const filtered = BUILTIN_SUGGESTIONS.filter((item) => item[0].startsWith(q));
    return filtered.length ? filtered : BUILTIN_SUGGESTIONS;
  }, [token]);
  const errors = compileResult?.errors ?? [];
  const compileText = useMemo(() => compileSummary(compileResult), [compileResult]);
  const activeLine = source.slice(0, cursor).split("\n").length;
  const offsets = useMemo(() => lineOffsets(source), [source]);

  const insertText = (value: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? start;
    const next = `${source.slice(0, start)}${value}${source.slice(end)}`;
    onSourceChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + value.length;
      ta.setSelectionRange(pos, pos);
      setCursor(pos);
    });
  };

  const jumpToLine = (line?: number | null, col?: number | null) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const lineIndex = Math.max(1, Math.min(offsets.length || 1, line ?? 1)) - 1;
    const start = offsets[lineIndex] ?? 0;
    const pos = Math.min(source.length, start + Math.max(1, col ?? 1) - 1);
    ta.focus();
    ta.setSelectionRange(pos, pos);
    setCursor(pos);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      onSave();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      onRun();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      if (showCompletions && completionItems[completionIndex]) {
        insertText(completionItems[completionIndex][3]);
        setShowCompletions(false);
        return;
      }
      insertText("  ");
      return;
    }
    if (event.key === "ArrowDown" && showCompletions) {
      event.preventDefault();
      setCompletionIndex((value) => (value + 1) % completionItems.length);
      return;
    }
    if (event.key === "ArrowUp" && showCompletions) {
      event.preventDefault();
      setCompletionIndex((value) => (value - 1 + completionItems.length) % completionItems.length);
      return;
    }
    if (event.key === "Escape" && showCompletions) {
      event.preventDefault();
      setShowCompletions(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-terminal-panel text-terminal-text">
      <div className="flex items-center justify-between gap-2 border-b border-terminal-border px-3 py-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terminal-accent">OpenScript Editor</div>
          <div className="truncate text-[10px] text-terminal-muted">
            {selectedScriptId ? title : "Draft"} | {chartSymbol || "No symbol"} | {chartMarket || "MKT"} | {dirty ? "Unsaved" : "Saved"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="rounded border border-terminal-border px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-terminal-muted" onClick={onClose}>Close</button>
          <button type="button" className="rounded border border-terminal-border px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-terminal-muted disabled:opacity-50" onClick={onSave} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
          <button type="button" className="rounded border border-terminal-accent bg-terminal-accent/15 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-terminal-accent disabled:opacity-50" onClick={onRun} disabled={running}>{running ? "Running..." : "Run"}</button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col border-r border-terminal-border bg-terminal-bg/70 px-3 py-3">
          <label className="block text-[11px] uppercase tracking-[0.14em] text-terminal-muted">
            Name
            <input value={title} onChange={(event) => onTitleChange(event.target.value)} className="mt-1 w-full rounded border border-terminal-border bg-terminal-panel px-2 py-1 text-xs text-terminal-text outline-none focus:border-terminal-accent" />
          </label>
          <label className="mt-3 block text-[11px] uppercase tracking-[0.14em] text-terminal-muted">
            Description
            <textarea value={description} onChange={(event) => onDescriptionChange(event.target.value)} className="mt-1 h-20 w-full resize-none rounded border border-terminal-border bg-terminal-panel px-2 py-1 text-xs text-terminal-text outline-none focus:border-terminal-accent" />
          </label>
          <label className="mt-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-terminal-muted">
            <input type="checkbox" checked={isPublic} onChange={(event) => onPublicChange(event.target.checked)} className="h-3.5 w-3.5 rounded border-terminal-border bg-terminal-panel text-terminal-accent" />
            Public script
          </label>

          <div className="mt-4 rounded border border-terminal-border bg-terminal-panel/60 p-2 text-[11px]">
            <div className="uppercase tracking-[0.16em] text-terminal-muted">Context</div>
            <div className="mt-1 text-terminal-text">{chartSymbol || "No active symbol"}</div>
            <div className="text-terminal-muted">{chartMarket || "Unknown market"}</div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {SNIPPETS.map((snippet) => (
              <button key={snippet.label} type="button" className="rounded border border-terminal-border px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-terminal-muted" onClick={() => insertText(`${snippet.value}\n`)}>
                {snippet.label}
              </button>
            ))}
          </div>

          <div className="mt-4 min-h-0 flex-1 rounded border border-terminal-border bg-terminal-panel/50 p-2 text-[11px]">
            <div className="flex items-center justify-between uppercase tracking-[0.16em] text-terminal-muted">
              <span>Compiler</span>
              <span>{compileResult?.success ? "Ready" : "Diagnostics"}</span>
            </div>
            <div className="mt-2 text-terminal-text">{compileText}</div>
            <div className="mt-2 text-terminal-muted">Cursor token: {token || "-"}</div>
            <div className="mt-2 rounded border border-terminal-border/70 bg-terminal-bg/60 p-2 text-terminal-muted">
              {suggestion ? (
                <>
                  <div className="text-terminal-accent">{suggestion[0]}</div>
                  <div>{suggestion[2]}</div>
                  <div className="mt-1 text-terminal-text">{suggestion[1]}</div>
                </>
              ) : (
                <div>Type a builtin to see hints.</div>
              )}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="relative flex min-h-0 flex-1 bg-terminal-canvas">
            <div className="pointer-events-none absolute inset-0 flex">
              <div className="w-12 border-r border-terminal-border bg-terminal-bg/85 px-2 py-2 text-right font-mono text-[10px] leading-5 text-terminal-muted">
                {source.split("\n").map((_, index) => (
                  <div key={index + 1} className={index + 1 === activeLine ? "text-terminal-accent" : ""}>{index + 1}</div>
                ))}
              </div>
              <pre ref={previewRef} className="flex-1 overflow-auto px-3 py-2 font-mono text-[12px] leading-5 text-terminal-text" aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlightSource(source) }} />
            </div>

            <textarea
              ref={textareaRef}
              value={source}
              onChange={(event) => {
                onSourceChange(event.target.value);
                setShowCompletions(true);
                setCursor(event.target.selectionStart ?? event.target.value.length);
              }}
              onScroll={() => {
                const ta = textareaRef.current;
                const pre = previewRef.current;
                if (!ta || !pre) return;
                pre.scrollTop = ta.scrollTop;
                pre.scrollLeft = ta.scrollLeft;
              }}
              onSelect={() => setCursor(textareaRef.current?.selectionStart ?? 0)}
              onClick={() => setCursor(textareaRef.current?.selectionStart ?? 0)}
              onKeyUp={() => setCursor(textareaRef.current?.selectionStart ?? 0)}
              onKeyDown={handleKeyDown}
              className="relative z-10 h-full min-h-[380px] w-full resize-none overflow-auto bg-transparent px-3 py-2 font-mono text-[12px] leading-5 text-transparent caret-terminal-accent outline-none selection:bg-terminal-accent/20"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
            />

            {showCompletions && completionItems.length ? (
              <div className="absolute right-3 top-3 z-20 w-64 rounded border border-terminal-accent/50 bg-terminal-panel/95 p-2 shadow-xl">
                <div className="text-[10px] uppercase tracking-[0.16em] text-terminal-muted">Autocomplete</div>
                <div className="mt-2 space-y-1">
                  {completionItems.map((item, index) => (
                    <button
                      key={item[0]}
                      type="button"
                      className={`block w-full rounded border px-2 py-1 text-left text-xs ${index === completionIndex ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent" : "border-terminal-border text-terminal-text"}`}
                      onMouseEnter={() => setCompletionIndex(index)}
                      onClick={() => {
                        insertText(item[3]);
                        setShowCompletions(false);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{item[0]}</span>
                        <span className="text-[10px] text-terminal-muted">{item[1]}</span>
                      </div>
                      <div className="text-[10px] text-terminal-muted">{item[2]}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t border-terminal-border bg-terminal-panel">
            <div className="flex items-center gap-2 border-b border-terminal-border/70 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-terminal-muted">
              <button type="button" className={`rounded px-2 py-1 ${tab === "errors" ? "bg-terminal-accent/15 text-terminal-accent" : ""}`} onClick={() => setTab("errors")}>Errors ({errors.length})</button>
              <button type="button" className={`rounded px-2 py-1 ${tab === "output" ? "bg-terminal-accent/15 text-terminal-accent" : ""}`} onClick={() => setTab("output")}>Output ({runResult?.outputs.length ?? 0})</button>
              <div className="ml-auto truncate text-terminal-muted">{selectedScriptId ? runResult?.script_name ?? title : "Draft editor"}</div>
            </div>

            {tab === "errors" ? (
              <div className="max-h-40 overflow-auto px-3 py-2 text-[11px]">
                {errors.length ? (
                  <div className="space-y-1">
                    {errors.map((error, index) => (
                      <button key={`${error.message}-${index}`} type="button" className="block w-full rounded border border-terminal-border/70 bg-terminal-bg/50 px-2 py-1 text-left" onClick={() => jumpToLine(error.line, error.col)}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-terminal-neg">{error.message}</span>
                          <span className="text-terminal-muted">L{error.line ?? "-"}:{error.col ?? "-"}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-terminal-muted">{compileResult?.success ? "No compile errors." : "Compile the script to see diagnostics."}</div>
                )}
              </div>
            ) : (
              <div className="max-h-40 overflow-auto px-3 py-2 text-[11px]">
                {runResult?.outputs.length ? (
                  <div className="space-y-3">
                    {runResult.outputs.map((output, index) => {
                      const values = numericSeries(output.series);
                      return (
                        <div key={`${output.kind}-${index}`} className="rounded border border-terminal-border/70 bg-terminal-bg/50 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="font-semibold text-terminal-accent">{output.title || output.kind.toUpperCase()}</div>
                              <div className="text-terminal-muted">{output.kind} | {output.series.length} row(s)</div>
                            </div>
                            {output.message ? <div className="text-terminal-muted">{output.message}</div> : null}
                          </div>
                          {values.length ? (
                            <div className="mt-2">
                              <SparklineCell points={values} width={220} height={48} color={output.color || "var(--ot-color-accent-primary)"} areaColor="var(--ot-color-feedback-info-soft)" className="rounded border border-terminal-border/60 bg-terminal-panel" ariaLabel={`${output.kind} preview`} showTooltip />
                            </div>
                          ) : (
                            <div className="mt-2 text-terminal-muted">No numeric preview available.</div>
                          )}
                        </div>
                      );
                    })}
                    <div className="text-terminal-muted">Preview rows: {runResult.row_count}</div>
                  </div>
                ) : (
                  <div className="text-terminal-muted">Run the script to populate the preview panel.</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
