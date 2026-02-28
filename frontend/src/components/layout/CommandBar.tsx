import { useEffect, useMemo, useRef, useState } from "react";
import { Search, History, Command as CommandIcon, Loader2, Sparkles, X, ArrowRight } from "lucide-react";
import Fuse from "fuse.js";
import { useNavigate } from "react-router-dom";

import { fetchCryptoSearch, searchSymbols, aiQuery, type SearchSymbolItem } from "../../api/client";
import {
  COMMAND_FUNCTIONS,
  parseCommand,
  executeParsedCommand,
  type CommandExecutionResult,
  type CommandSuggestion,
} from "./commanding";
import { useSettingsStore } from "../../store/settingsStore";
import { useStockStore } from "../../store/stockStore";
import { AIQueryResult } from "../../types";

type Props = {
  onExecute: (command: string) => Promise<CommandExecutionResult> | CommandExecutionResult;
};

const HISTORY_KEY = "ot:gobar:history:v1";
const INSTRUMENT_CACHE_KEY = "ot:gobar:instrument-cache:v1";
const MAX_HISTORY = 20;

type VisualState = "idle" | "success" | "error";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

function dedupeTickers(items: SearchSymbolItem[]): SearchSymbolItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = `${String(item.ticker || "").toUpperCase()}|${String(item.exchange || "").toUpperCase()}|${String(item.name || "").toUpperCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function CommandBar({ onExecute }: Props) {
  const navigate = useNavigate();
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const activeTicker = useStockStore((s) => s.ticker);

  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);

  // AI States
  const [thinking, setThinking] = useState(false);
  const [aiResult, setAiResult] = useState<AIQueryResult | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiHistory, setAiHistory] = useState<string[]>([]);

  const [flashState, setFlashState] = useState<VisualState>("idle");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [history, setHistory] = useState<string[]>(() => (typeof window !== "undefined" ? readJson<string[]>(HISTORY_KEY, []) : []));
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [reverseSearchOpen, setReverseSearchOpen] = useState(false);
  const [remoteTickers, setRemoteTickers] = useState<SearchSymbolItem[]>([]);
  const [searchingTickers, setSearchingTickers] = useState(false);
  const [instrumentCache, setInstrumentCache] = useState<SearchSymbolItem[]>(() => (typeof window !== "undefined" ? readJson<SearchSymbolItem[]>(INSTRUMENT_CACHE_KEY, []) : []));
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchReqRef = useRef(0);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    writeJson(HISTORY_KEY, history.slice(0, MAX_HISTORY));
  }, [history]);

  useEffect(() => {
    writeJson(INSTRUMENT_CACHE_KEY, instrumentCache.slice(0, 200));
  }, [instrumentCache]);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const isEditing = Boolean(
        target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable),
      );

      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "g") {
        ev.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setIsOpen(true);
        setReverseSearchOpen(false);
        return;
      }

      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "r" && document.activeElement === inputRef.current) {
        ev.preventDefault();
        setReverseSearchOpen((v) => !v);
        setIsOpen(true);
        return;
      }

      if (ev.key === "Escape" && (document.activeElement === inputRef.current || isEditing)) {
        setIsOpen(false);
        setReverseSearchOpen(false);
        inputRef.current?.blur();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 2) {
      setRemoteTickers([]);
      setSearchingTickers(false);
      return;
    }

    const reqId = ++searchReqRef.current;
    setSearchingTickers(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const [equities, crypto] = await Promise.all([
            searchSymbols(query, selectedMarket),
            fetchCryptoSearch(query),
          ]);
          if (reqId !== searchReqRef.current) return;
          const merged = dedupeTickers([...(equities || []), ...(crypto || [])]).slice(0, 20);
          setRemoteTickers(merged);
          if (merged.length) {
            setInstrumentCache((prev) => {
              const next = dedupeTickers([...merged, ...prev]);
              return next.slice(0, 200);
            });
          }
        } catch {
          if (reqId === searchReqRef.current) setRemoteTickers([]);
        } finally {
          if (reqId === searchReqRef.current) setSearchingTickers(false);
        }
      })();
    }, 180);

    return () => clearTimeout(timer);
  }, [selectedMarket, value]);

  const suggestions = useMemo<CommandSuggestion[]>(() => {
    const q = value.trim();
    const items: Array<CommandSuggestion & { score: number }> = [];

    if (reverseSearchOpen) {
      if (q) {
        const histFuse = new Fuse(history.map((cmd, idx) => ({ cmd, idx })), {
          keys: ["cmd"],
          includeScore: true,
          threshold: 0.4,
        });
        histFuse.search(q, { limit: 20 }).forEach((result) => {
          items.push({
            kind: "recent",
            key: `recent:${result.item.idx}:${result.item.cmd}`,
            title: result.item.cmd,
            subtitle: "Command history",
            command: result.item.cmd,
            score: 1000 - (result.score ?? 1) * 1000,
          });
        });
      } else {
        history.forEach((cmd, idx) => {
          items.push({
            kind: "recent",
            key: `recent:${idx}:${cmd}`,
            title: cmd,
            subtitle: "Command history",
            command: cmd,
            score: 1000 - idx,
          });
        });
      }
      return items.sort((a, b) => b.score - a.score).slice(0, 20);
    }

    if (q) {
      const historyFuse = new Fuse(history.map((cmd, idx) => ({ cmd, idx })), {
        keys: ["cmd"],
        includeScore: true,
        threshold: 0.45,
      });
      historyFuse.search(q, { limit: 6 }).forEach((result) => {
        items.push({
          kind: "recent",
          key: `history:${result.item.idx}:${result.item.cmd}`,
          title: result.item.cmd,
          subtitle: "Recent command",
          command: result.item.cmd,
          score: 400 - (result.score ?? 1) * 200,
        });
      });
    } else {
      history.slice(0, 4).forEach((cmd, idx) => {
        items.push({
          kind: "recent",
          key: `history:${idx}:${cmd}`,
          title: cmd,
          subtitle: "Recent command",
          command: cmd,
          score: 220 - idx,
        });
      });
    }

    if (q) {
      const fnFuse = new Fuse(
        COMMAND_FUNCTIONS.map((fn) => ({
          ...fn,
          aliasText: (fn.aliases || []).join(" "),
        })),
        {
          keys: [
            { name: "code", weight: 0.45 },
            { name: "label", weight: 0.25 },
            { name: "description", weight: 0.2 },
            { name: "aliasText", weight: 0.1 },
          ],
          includeScore: true,
          threshold: 0.42,
        },
      );
      fnFuse.search(q, { limit: 8 }).forEach((result) => {
        const fn = result.item;
        items.push({
          kind: "function",
          key: `fn:${fn.code}`,
          title: fn.code,
          subtitle: fn.description,
          command: fn.code,
          score: 350 - (result.score ?? 1) * 200,
        });
      });
    } else {
      COMMAND_FUNCTIONS.slice(0, 6).forEach((fn, idx) => {
        items.push({
          kind: "function",
          key: `fn:${fn.code}`,
          title: fn.code,
          subtitle: fn.description,
          command: fn.code,
          score: 180 - idx,
        });
      });
    }

    const tickerPool = dedupeTickers([...remoteTickers, ...instrumentCache]).slice(0, 80);
    if (q) {
      const tickerFuse = new Fuse(
        tickerPool.map((item) => ({
          ...item,
          ticker: String(item.ticker || "").toUpperCase(),
          exchange: String(item.exchange || "").toUpperCase(),
        })),
        {
          keys: [
            { name: "ticker", weight: 0.55 },
            { name: "name", weight: 0.3 },
            { name: "exchange", weight: 0.15 },
          ],
          includeScore: true,
          threshold: 0.38,
        },
      );
      tickerFuse.search(q, { limit: 8 }).forEach((result) => {
        const item = result.item;
        const symbol = String(item.ticker || "").toUpperCase();
        if (!symbol) return;
        items.push({
          kind: "ticker",
          key: `ticker:${symbol}:${item.exchange || ""}`,
          title: symbol,
          subtitle: [item.name, item.exchange].filter(Boolean).join(" - "),
          command: symbol,
          price: null,
          score: 500 - (result.score ?? 1) * 250,
        });
      });
    } else {
      tickerPool.slice(0, 4).forEach((item, idx) => {
        const symbol = String(item.ticker || "").toUpperCase();
        if (!symbol) return;
        items.push({
          kind: "ticker",
          key: `ticker:${symbol}:${item.exchange || ""}`,
          title: symbol,
          subtitle: [item.name, item.exchange].filter(Boolean).join(" - "),
          command: symbol,
          price: null,
          score: 100 - idx,
        });
      });
    }

    return items
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ score: _score, ...rest }) => rest);
  }, [history, instrumentCache, remoteTickers, reverseSearchOpen, value]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [value, reverseSearchOpen]);

  const commitHistory = (cmd: string) => {
    const normalized = cmd.trim();
    if (!normalized) return;
    setHistory((prev) => [normalized, ...prev.filter((v) => v !== normalized)].slice(0, MAX_HISTORY));
    setHistoryCursor(null);
  };

  const triggerFlash = (next: VisualState) => {
    setFlashState(next);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashState("idle"), 420);
  };

  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
  }, []);

  const handleAiQuery = async (query: string) => {
    setThinking(true);
    setAiOpen(true);
    setAiResult(null);
    try {
      const result = await aiQuery(query, {
        active_symbol: activeTicker,
        history: aiHistory.slice(-5)
      });
      setAiResult(result);
      setAiHistory(prev => [...prev, query].slice(-5));

      if (result.type === "chart_command" && result.data?.url) {
        navigate(result.data.url);
      }
    } catch (err) {
      setAiResult({ type: "text_answer", data: "Error connecting to AI service.", explanation: "Connection error" });
    } finally {
      setThinking(false);
    }
  };

  const submitCommand = async (rawCommand?: string) => {
    const command = (rawCommand ?? value).trim();
    if (!command) return;

    const parsed = parseCommand(command);
    if (parsed.kind === "natural-language" && command.includes(" ")) {
      void handleAiQuery(command);
      setValue("");
      commitHistory(command);
      return;
    }

    setLoading(true);
    setIsOpen(false);
    setReverseSearchOpen(false);
    setAiOpen(false);
    try {
      const result = await onExecute(command);
      if (result.ok) {
        commitHistory(command);
        setValue("");
        triggerFlash("success");
      } else {
        triggerFlash("error");
      }
    } catch {
      triggerFlash("error");
    } finally {
      setLoading(false);
    }
  };

  const activeSuggestion = suggestions[selectedIndex];

  return (
    <div className="relative z-40 border-b border-terminal-border bg-[#0D1117]/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-[#0D1117]/88">
      <div
        className={[
          "relative flex items-center gap-2 rounded-sm border bg-[#161B22] px-2 py-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]",
          flashState === "success"
            ? "border-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]"
            : flashState === "error"
              ? "border-rose-500 shadow-[0_0_0_1px_rgba(244,63,94,0.35)]"
              : focused
                ? "border-[#FF6B00] shadow-[0_0_0_1px_rgba(255,107,0,0.28)]"
                : "border-terminal-border",
        ].join(" ")}
      >
        <Search className="h-4 w-4 shrink-0 text-terminal-muted" />
        <input
          ref={inputRef}
          value={value}
          onFocus={() => {
            setFocused(true);
            setIsOpen(true);
          }}
          onBlur={() => {
            setFocused(false);
            setTimeout(() => setIsOpen(false), 100);
          }}
          onChange={(e) => {
            setValue(e.target.value);
            setIsOpen(true);
            setHistoryCursor(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIsOpen(true);
              setSelectedIndex((idx) => (suggestions.length ? (idx + 1) % suggestions.length : 0));
              return;
            }
            if (e.key === "ArrowUp") {
              if (!value.trim()) {
                e.preventDefault();
                setHistoryCursor((prev) => {
                  const next = prev == null ? 0 : Math.min(prev + 1, history.length - 1);
                  const cmd = history[next];
                  if (cmd) setValue(cmd);
                  return history.length ? next : null;
                });
                return;
              }
              e.preventDefault();
              setSelectedIndex((idx) => (suggestions.length ? (idx - 1 + suggestions.length) % suggestions.length : 0));
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (isOpen && activeSuggestion) {
                void submitCommand(activeSuggestion.command);
              } else {
                void submitCommand();
              }
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setIsOpen(false);
              setReverseSearchOpen(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="h-8 min-w-0 flex-1 bg-transparent px-0 text-sm text-terminal-text outline-none placeholder:text-[#6E7681] ot-type-data"
          style={{ caretColor: "#FF6B00", fontFamily: '"Fira Code", var(--ot-font-data)' }}
          placeholder="Type ticker, command, or search... (Ctrl+G)"
          aria-label="Command bar"
          autoComplete="off"
        />
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-terminal-accent" /> : null}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void submitCommand()}
          className="inline-flex h-8 items-center rounded-sm border border-emerald-500/40 bg-emerald-500/15 px-3 ot-type-label text-emerald-400 hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/40"
        >
          GO
        </button>
      </div>

      {/* AI Response Panel */}
      {aiOpen && (
        <div className="absolute left-3 right-3 top-[calc(100%+4px)] z-50 overflow-hidden rounded-sm border border-terminal-border bg-[#0D1117] shadow-2xl">
          <div className="flex items-center justify-between border-b border-terminal-border bg-terminal-accent/10 px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-bold text-terminal-accent">
              <Sparkles size={14} />
              AI RESEARCH COPILOT
            </div>
            <button onClick={() => setAiOpen(false)} className="text-terminal-muted hover:text-terminal-text">
              <X size={14} />
            </button>
          </div>

          <div className="max-h-[400px] overflow-auto p-4">
            {thinking ? (
              <div className="flex items-center gap-3 py-4 text-sm text-terminal-muted">
                <Loader2 className="h-5 w-5 animate-spin text-terminal-accent" />
                Synthesizing market data and intent...
              </div>
            ) : aiResult ? (
              <div className="space-y-4">
                <div className="text-sm leading-relaxed text-terminal-text">
                  {aiResult.explanation}
                </div>

                {aiResult.type === 'data_table' && aiResult.data && (
                  <div className="mt-2 overflow-x-auto rounded border border-terminal-border">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-terminal-bg-accent text-terminal-muted">
                        <tr>
                          <th className="px-2 py-1">TICKER</th>
                          <th className="px-2 py-1 text-right">PRICE</th>
                          <th className="px-2 py-1 text-right">CHG%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-terminal-border/50">
                        {aiResult.data.map((row: any, i: number) => (
                          <tr key={i} className="hover:bg-terminal-accent/5">
                            <td className="px-2 py-1 font-bold text-terminal-accent">{row.symbol}</td>
                            <td className="px-2 py-1 text-right">{row.last?.toFixed(2)}</td>
                            <td className={`px-2 py-1 text-right ${row.changePct >= 0 ? 'text-terminal-pos' : 'text-terminal-neg'}`}>
                              {row.changePct?.toFixed(2)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {aiResult.type === 'screener_results' && aiResult.data && (
                  <div className="mt-2 overflow-x-auto rounded border border-terminal-border">
                    <table className="w-full text-left text-[10px] font-mono leading-tight">
                      <thead className="bg-terminal-bg-accent text-terminal-muted border-b border-terminal-border">
                        <tr>
                          {Object.keys(aiResult.data[0] || {}).map(key => (
                            <th key={key} className="px-2 py-1 uppercase tracking-wider">{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-terminal-border/20">
                        {aiResult.data.map((row: any, i: number) => (
                          <tr key={i} className="hover:bg-terminal-accent/10">
                            {Object.values(row).map((val: any, j: number) => (
                              <td key={j} className={`px-2 py-1 ${j === 0 ? 'font-bold text-terminal-accent' : 'text-terminal-text'}`}>
                                {typeof val === 'number' ? val.toFixed(2) : val}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {aiResult.type === 'chart_command' && (
                  <div className="flex items-center gap-2 rounded border border-terminal-pos/30 bg-terminal-pos/10 p-2 text-xs text-terminal-pos">
                    <ArrowRight size={14} />
                    Navigated to requested chart.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {isOpen && (suggestions.length > 0 || searchingTickers) ? (
        <div className="absolute left-3 right-3 top-[calc(100%-2px)] z-50 mt-1 overflow-hidden rounded-sm border border-terminal-border bg-[#0F141B] shadow-2xl">
          <div className="flex items-center justify-between border-b border-terminal-border px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-terminal-muted">
            <div className="inline-flex items-center gap-2">
              {reverseSearchOpen ? <History className="h-3.5 w-3.5" /> : <CommandIcon className="h-3.5 w-3.5" />}
              <span>{reverseSearchOpen ? "Reverse History Search (Ctrl+R)" : "Suggestions"}</span>
            </div>
            <span>{searchingTickers ? "Searching..." : "Enter to GO"}</span>
          </div>
          <div className="max-h-72 overflow-auto py-1">
            {suggestions.map((item, idx) => (
              <button
                key={item.key}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void submitCommand(item.command)}
                className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 px-2 py-1.5 text-left ${
                  idx === selectedIndex ? "bg-[#1A2332]" : "hover:bg-terminal-panel"
                }`}
              >
                <span
                  className={`inline-flex h-5 items-center rounded-sm border px-1.5 text-[10px] ot-type-label ${
                    item.kind === "function"
                      ? "border-[#FF6B00]/40 text-[#FF6B00]"
                      : item.kind === "recent"
                        ? "border-terminal-border text-terminal-muted"
                        : "border-sky-500/30 text-sky-400"
                  }`}
                >
                  {item.kind === "function" ? "FN" : item.kind === "recent" ? "HIST" : "SYM"}
                </span>
                <span className="min-w-0">
                  <span className="block truncate ot-type-data text-xs text-terminal-text">{item.title}</span>
                  <span className="block truncate text-[11px] text-terminal-muted">{item.subtitle}</span>
                </span>
                {"price" in item && item.price != null ? (
                  <span className="ot-type-data text-xs text-terminal-muted">{item.price.toFixed(2)}</span>
                ) : (
                  <span className="ot-type-data text-xs text-terminal-muted">{item.command}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
