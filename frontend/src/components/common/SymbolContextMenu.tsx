import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  Bell,
  Building2,
  Check,
  Columns3,
  Copy,
  Plus,
  X,
} from "lucide-react";

import { addWatchlistItem } from "../../api/client";
import { useStockStore } from "../../store/stockStore";

export type SymbolContextMenuAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  onAction: (symbol: string) => void | Promise<void>;
  separator?: boolean;
  danger?: boolean;
  disabled?: boolean;
};

type AnchorPoint = {
  x: number;
  y: number;
};

type Props = {
  open: boolean;
  symbol: string | null;
  anchor: AnchorPoint | null;
  onClose: () => void;
  customActions?: SymbolContextMenuAction[] | ((symbol: string) => SymbolContextMenuAction[]);
  title?: string;
  market?: string;
  assetClass?: string;
};

function normalizeSymbol(symbol: string | null): string {
  return String(symbol ?? "").trim().toUpperCase();
}

function mergeActions(
  symbol: string,
  navigate: ReturnType<typeof useNavigate>,
  customActions?: SymbolContextMenuAction[] | ((symbol: string) => SymbolContextMenuAction[]),
): SymbolContextMenuAction[] {
  const actions: SymbolContextMenuAction[] = [
    {
      id: "view-chart",
      label: "View Chart",
      icon: <BarChart3 className="h-3.5 w-3.5" />,
      shortcut: "Enter",
      onAction: async (nextSymbol) => {
        const activeTicker = nextSymbol.trim().toUpperCase();
        if (!activeTicker) return;
        useStockStore.getState().setTicker(activeTicker);
        navigate("/equity/chart-workstation");
      },
    },
    {
      id: "security-hub",
      label: "Security Hub",
      icon: <Building2 className="h-3.5 w-3.5" />,
      onAction: async (nextSymbol) => {
        const activeTicker = nextSymbol.trim().toUpperCase();
        if (!activeTicker) return;
        useStockStore.getState().setTicker(activeTicker);
        navigate(`/equity/security/${encodeURIComponent(activeTicker)}`);
      },
    },
    {
      id: "add-watchlist",
      label: "Add to Watchlist",
      icon: <Plus className="h-3.5 w-3.5" />,
      onAction: async (nextSymbol) => {
        const activeTicker = nextSymbol.trim().toUpperCase();
        if (!activeTicker) return;
        await addWatchlistItem({ watchlist_name: "Default", ticker: activeTicker });
      },
    },
    {
      id: "create-alert",
      label: "Create Alert",
      icon: <Bell className="h-3.5 w-3.5" />,
      onAction: async (nextSymbol) => {
        const activeTicker = nextSymbol.trim().toUpperCase();
        if (!activeTicker) return;
        useStockStore.getState().setTicker(activeTicker);
        navigate(`/equity/alerts?ticker=${encodeURIComponent(activeTicker)}`);
      },
    },
    {
      id: "compare",
      label: "Compare",
      icon: <Columns3 className="h-3.5 w-3.5" />,
      onAction: async (nextSymbol) => {
        const activeTicker = nextSymbol.trim().toUpperCase();
        if (!activeTicker) return;
        useStockStore.getState().setTicker(activeTicker);
        navigate(`/equity/compare?symbols=${encodeURIComponent(activeTicker)}`);
      },
    },
    {
      id: "copy-ticker",
      label: "Copy Ticker",
      icon: <Copy className="h-3.5 w-3.5" />,
      shortcut: "Ctrl+C",
      onAction: async (nextSymbol) => {
        const activeTicker = nextSymbol.trim().toUpperCase();
        if (!activeTicker) return;
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(activeTicker);
        }
      },
    },
  ];

  const extra = typeof customActions === "function" ? customActions(symbol) : customActions ?? [];
  const custom = extra.filter((item) => Boolean(item?.id && item?.label));
  if (!custom.length) return actions;
  return [
    ...actions,
    {
      ...custom[0],
      separator: true,
    },
    ...custom.slice(1),
  ];
}

export function SymbolContextMenu({
  open,
  symbol,
  anchor,
  onClose,
  customActions,
  title,
  market,
  assetClass,
}: Props) {
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeSymbol = normalizeSymbol(symbol);
  const actions = useMemo(() => mergeActions(activeSymbol, navigate, customActions), [activeSymbol, navigate, customActions]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
  }, [open, activeSymbol]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    const next = buttonRefs.current[activeIndex];
    next?.focus();
  }, [activeIndex, open]);

  const menuLeft = useMemo(() => {
    if (!anchor || typeof window === "undefined") return 0;
    return Math.max(8, Math.min(anchor.x, window.innerWidth - 272));
  }, [anchor]);

  const menuTop = useMemo(() => {
    if (!anchor || typeof window === "undefined") return 0;
    return Math.max(8, Math.min(anchor.y, window.innerHeight - 320));
  }, [anchor]);

  if (!open || !activeSymbol || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={title ? `${title} for ${activeSymbol}` : `Context menu for ${activeSymbol}`}
      className="fixed z-[220] w-[17rem] overflow-hidden rounded-sm border border-terminal-border bg-[#0F141B] shadow-2xl"
      style={{ left: menuLeft, top: menuTop }}
      onKeyDown={(event) => {
        if (!actions.length) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((idx) => (idx + 1) % actions.length);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex((idx) => (idx - 1 + actions.length) % actions.length);
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          setActiveIndex(0);
          return;
        }
        if (event.key === "End") {
          event.preventDefault();
          setActiveIndex(actions.length - 1);
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          const action = actions[activeIndex];
          if (!action || action.disabled) return;
          onClose();
          void Promise.resolve(action.onAction(activeSymbol)).catch(() => undefined);
        }
      }}
    >
      <div className="border-b border-terminal-border bg-terminal-panel px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-mono text-xs text-terminal-text">{activeSymbol}</div>
            <div className="truncate text-[10px] uppercase tracking-[0.14em] text-terminal-muted">
              {assetClass || market || "Symbol actions"}
            </div>
          </div>
          <button
            type="button"
            className="rounded-sm border border-terminal-border p-1 text-terminal-muted hover:text-terminal-text"
            onClick={onClose}
            aria-label="Close context menu"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="p-1">
        {actions.map((action, index) => (
          <div key={action.id}>
            {action.separator ? <div className="my-1 border-t border-terminal-border" /> : null}
            <button
              ref={(node) => {
                buttonRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              aria-disabled={action.disabled || undefined}
              disabled={action.disabled}
              className={`flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors ${
                action.danger ? "text-terminal-neg" : "text-terminal-text"
              } ${activeIndex === index ? "bg-terminal-bg" : "hover:bg-terminal-bg"} disabled:cursor-not-allowed disabled:opacity-50`}
              onMouseEnter={() => {
                if (!action.disabled) setActiveIndex(index);
              }}
              onClick={() => {
                if (action.disabled) return;
                onClose();
                void Promise.resolve(action.onAction(activeSymbol)).catch(() => undefined);
              }}
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-terminal-muted">
                  {action.icon ?? <Check className="h-3 w-3 opacity-0" />}
                </span>
                <span className="truncate">{action.label}</span>
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-terminal-muted">
                {action.shortcut || ""}
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
